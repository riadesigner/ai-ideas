const MODEL_PATH = "models/vosk-model-small-ru-0.22.tar.gz";
const CACHE = "dictation-v1";
const STATES = {
  idle: "Ожидание",
  loading: "Загрузка распознавателя",
  listening: "Слушаю",
  processing: "Собираю идею",
  denied: "Нет доступа к микрофону",
  error: "Ошибка",
};
const STOP_TAIL = /(?:^|\s+)стоп[.!?…]*$/iu;

const talk = document.getElementById("talk");
const processButton = document.getElementById("process");
const transcript = document.getElementById("transcript");
const interim = document.getElementById("interim");
const copyButton = document.getElementById("copy");
const clearButton = document.getElementById("clear");
const stateLabel = document.getElementById("state-label");
const stateDetail = document.getElementById("state-detail");
const progress = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");

let state = "idle";
let model = null;
let modelPromise = null;
let modelReady = false;
let recognizer = null;
let audioContext = null;
let stream = null;
let source = null;
let processor = null;
let mute = null;
let listening = false;
let pending = 0;
let stopFlush = null;
let clearTimer = null;
let lastPartial = "";
let parkedPartial = "";
let dropResults = false;
let finishing = null;
let savedIdea = null;

talk.addEventListener("click", onTalk);
processButton.addEventListener("click", () => {
  beginProcess();
});
copyButton.addEventListener("click", copyText);
clearButton.addEventListener("click", clearText);

if (!window.isSecureContext) {
  setState(
    "error",
    "Микрофон доступен только по HTTPS или на localhost. Откройте эту страницу в Chrome по защищённой ссылке."
  );
}

function onTalk() {
  if (state === "listening" || state === "loading" || state === "processing") {
    return;
  }
  hideSaved();
  startFromGesture();
}

function startFromGesture() {
  if (!window.isSecureContext) {
    setState(
      "error",
      "Микрофон доступен только по HTTPS или на localhost. Откройте эту страницу в Chrome по защищённой ссылке."
    );
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setState("error", "В этом браузере нет доступа к микрофону.");
    return;
  }

  const permission = navigator.mediaDevices.getUserMedia(micConstraints());
  setState("loading", "Скачиваю модель на телефон…");
  permission
    .then((probe) => {
      probe.getTracks().forEach((track) => track.stop());
      return ensureEngine().then(startListening);
    })
    .catch((error) => {
      const mic = describeMicError(error);
      if (mic) {
        setState(mic.state, mic.detail);
        return;
      }
      setState("error", error && error.message ? error.message : "Не получилось запустить распознавание.");
    });
}

function micConstraints() {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    },
    video: false,
  };
}

function describeMicError(error) {
  const name = error && error.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return {
      state: "denied",
      detail: "В Chrome нажмите замок слева от адреса, откройте разрешения и разрешите микрофон.",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return { state: "error", detail: "Микрофон не найден." };
  }
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") {
    return { state: "error", detail: "Микрофон занят другим приложением." };
  }
  return null;
}

function ensureEngine() {
  if (modelReady && model) {
    return Promise.resolve(model);
  }
  if (!modelPromise) {
    modelPromise = loadEngine().catch((error) => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

async function loadEngine() {
  if (!window.Vosk) {
    throw new Error("Распознаватель не найден в файлах страницы.");
  }
  await activateServiceWorker();
  const modelUrl = new URL(MODEL_PATH, window.location.href).href;
  await ensureModelCached(modelUrl);
  setState("loading", "Готовлю распознавание на телефоне…");
  model = await openModel(modelUrl);
  modelReady = true;
  return model;
}

function activateServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return Promise.reject(new Error("Нужен сервис-воркер, чтобы модель осталась на телефоне."));
  }
  return navigator.serviceWorker.register("sw.js").then(() => {
    if (navigator.serviceWorker.controller) {
      return undefined;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Сервис-воркер не запустился. Обновите страницу и попробуйте снова."));
      }, 10000);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  });
}

async function ensureModelCached(modelUrl) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(modelUrl);
  if (cached) {
    showProgress(1, 1);
    return;
  }

  let response;
  try {
    response = await fetch(modelUrl);
  } catch (error) {
    throw new Error("Нет сети, а модель ещё не на телефоне. Подключитесь один раз и нажмите «Говорить».");
  }
  if (!response.ok || !response.body) {
    throw new Error("Не удалось скачать модель.");
  }

  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) {
      break;
    }
    chunks.push(step.value);
    received += step.value.byteLength;
    showProgress(received, total);
  }

  const blob = new Blob(chunks, { type: "application/gzip" });
  try {
    await cache.put(
      modelUrl,
      new Response(blob, {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Length": String(blob.size),
        },
      })
    );
  } catch (error) {
    throw new Error("Не хватило места, чтобы сохранить модель на телефоне.");
  }
}

function showProgress(received, total) {
  progress.hidden = false;
  progressBar.classList.remove("indeterminate");
  if (total > 0) {
    const ratio = Math.max(0, Math.min(1, received / total));
    progressBar.style.width = `${Math.round(ratio * 100)}%`;
    if (received >= total) {
      setState("loading", "Модель скачана. Готовлю распознавание…");
      return;
    }
    setState("loading", `Скачиваю модель: ${megabytes(received)} из ${megabytes(total)} МБ`);
    return;
  }
  progressBar.style.width = "100%";
  setState("loading", `Скачиваю модель: ${megabytes(received)} МБ`);
}

function megabytes(bytes) {
  return (bytes / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function openModel(modelUrl) {
  return new Promise((resolve, reject) => {
    const instance = new Vosk.Model(modelUrl, -1);
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => reject(new Error("Распознаватель слишком долго готовится.")));
    }, 180000);

    function finish(action) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      action();
    }

    instance.on("load", (message) => {
      if (message.result) {
        finish(() => resolve(instance));
      } else {
        finish(() => reject(new Error("Модель не открылась на телефоне.")));
      }
    });
    instance.on("error", (message) => {
      finish(() => reject(new Error((message && message.error) || "Ошибка распознавания.")));
    });
  });
}

async function startListening() {
  stream = await navigator.mediaDevices.getUserMedia(micConstraints());
  audioContext = new AudioContext();
  if (!audioContext.audioWorklet) {
    throw new Error("Этот Chrome не умеет обрабатывать звук на странице.");
  }
  await audioContext.resume();
  await audioContext.audioWorklet.addModule("audio-worklet.js");

  const sampleRate = audioContext.sampleRate;
  recognizer = new model.KaldiRecognizer(sampleRate);
  recognizer.on("partialresult", onPartial);
  recognizer.on("result", onResult);
  recognizer.on("error", (message) => {
    failListening((message && message.error) || "Ошибка распознавания.");
  });

  source = audioContext.createMediaStreamSource(stream);
  processor = new AudioWorkletNode(audioContext, "pcm-processor");
  mute = audioContext.createGain();
  mute.gain.value = 0;
  pending = 0;
  listening = true;
  processor.port.onmessage = (event) => {
    if (!listening || !recognizer) {
      return;
    }
    if (pending > 12) {
      return;
    }
    pending += 1;
    try {
      recognizer.acceptWaveformFloat(event.data, sampleRate);
    } catch (error) {
      failListening(error.message || "Не удалось обработать звук.");
    }
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);
  setState("listening", "Говорите. Потом скажите «стоп» или нажмите «Обработай».");
}

function onPartial(message) {
  pending = Math.max(0, pending - 1);
  if (!listening) {
    return;
  }
  const partial = message && message.result && message.result.partial ? message.result.partial.trim() : "";
  lastPartial = partial;
  interim.textContent = partial ? `Сейчас: ${partial}` : "";
}

function onResult(message) {
  pending = Math.max(0, pending - 1);
  if (dropResults) {
    releaseFlush();
    return;
  }
  let text = message && message.result && message.result.text ? message.result.text.trim() : "";
  let saidStop = false;
  if (text && STOP_TAIL.test(text)) {
    saidStop = true;
    text = text.replace(STOP_TAIL, "").trim();
  }
  if (text) {
    if (parkedPartial) {
      if (text === parkedPartial) {
        /* already on screen */
      } else if (transcript.value.endsWith(parkedPartial) && text.startsWith(parkedPartial)) {
        replaceTail(parkedPartial, text);
      } else if (!(transcript.value.endsWith(parkedPartial) && parkedPartial.startsWith(text))) {
        appendText(text);
      }
      parkedPartial = "";
    } else {
      appendText(text);
    }
    lastPartial = "";
    if (listening) {
      interim.textContent = "";
    }
  }
  if (saidStop) {
    lastPartial = "";
    interim.textContent = "";
  }
  releaseFlush();
  if (saidStop) {
    dropResults = true;
    beginProcess();
  }
}

function releaseFlush() {
  if (!stopFlush) {
    return;
  }
  const finish = stopFlush;
  stopFlush = null;
  finish();
}

function replaceTail(previous, next) {
  const value = transcript.value;
  if (!value.endsWith(previous)) {
    appendText(next);
    return;
  }
  const start = transcript.selectionStart;
  const end = transcript.selectionEnd;
  const focused = document.activeElement === transcript;
  const caretAtEnd = start === end && end === value.length;
  transcript.value = value.slice(0, value.length - previous.length) + next;
  if (!focused || caretAtEnd) {
    transcript.selectionStart = transcript.selectionEnd = transcript.value.length;
    transcript.scrollTop = transcript.scrollHeight;
  } else {
    transcript.selectionStart = start;
    transcript.selectionEnd = end;
  }
}

function appendText(text) {
  const current = transcript.value;
  const spacer = current && !/\s$/.test(current) ? " " : "";
  const start = transcript.selectionStart;
  const end = transcript.selectionEnd;
  const focused = document.activeElement === transcript;
  const caretAtEnd = start === end && end === current.length;
  transcript.value = current + spacer + text;
  if (!focused || caretAtEnd) {
    transcript.selectionStart = transcript.selectionEnd = transcript.value.length;
    transcript.scrollTop = transcript.scrollHeight;
  } else {
    transcript.selectionStart = start;
    transcript.selectionEnd = end;
  }
}

function stopListening(options = {}) {
  const keepState = options.keepState === true;
  listening = false;
  teardownAudio();
  if (lastPartial && !dropResults) {
    appendText(lastPartial);
    parkedPartial = lastPartial;
  }
  lastPartial = "";
  interim.textContent = "";
  const current = recognizer;
  recognizer = null;
  if (!current) {
    if (!keepState) {
      setState("idle", idleDetail());
    }
    return Promise.resolve();
  }
  const flushed = new Promise((resolve) => {
    stopFlush = resolve;
    setTimeout(resolve, 1500);
  });
  try {
    current.retrieveFinalResult();
  } catch (error) {
    releaseFlush();
  }
  if (!keepState) {
    setState("idle", idleDetail());
  }
  return flushed.then(() => {
    try {
      current.remove();
    } catch (error) {
      /* recognizer already gone */
    }
    interim.textContent = "";
    parkedPartial = "";
  });
}

function failListening(message) {
  listening = false;
  teardownAudio();
  if (recognizer) {
    try {
      recognizer.remove();
    } catch (error) {
      /* ignore */
    }
    recognizer = null;
  }
  interim.textContent = "";
  setState("error", message);
}

function teardownAudio() {
  if (processor) {
    processor.port.onmessage = null;
    processor.disconnect();
    processor = null;
  }
  if (source) {
    source.disconnect();
    source = null;
  }
  if (mute) {
    mute.disconnect();
    mute = null;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

function idleDetail() {
  return modelReady
    ? "Модель на телефоне. Звук остаётся здесь, на сервер уходит текст после «Обработай»."
    : "Первый запуск скачает модель, около 44 МБ. Звук остаётся на телефоне, на сервер уходит текст после «Обработай».";
}

async function copyText() {
  const text = transcript.value;
  if (!text) {
    return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (error) {
    transcript.focus();
    transcript.select();
    copied = document.execCommand("copy");
  }
  if (!copied) {
    return;
  }
  const previous = copyButton.textContent;
  copyButton.textContent = "Скопировано";
  setTimeout(() => {
    copyButton.textContent = previous;
  }, 1500);
}

function clearText() {
  if (!transcript.value && !interim.textContent && state !== "listening") {
    return;
  }
  if (clearButton.dataset.armed === "1") {
    const wipe = () => {
      transcript.value = "";
      interim.textContent = "";
      hideSaved();
      disarmClear();
    };
    if (listening || recognizer) {
      stopListening().then(wipe);
      return;
    }
    wipe();
    return;
  }
  clearButton.dataset.armed = "1";
  clearButton.textContent = "Точно очистить?";
  clearTimer = setTimeout(disarmClear, 3000);
}

function disarmClear() {
  clearButton.dataset.armed = "0";
  clearButton.textContent = "Очистить";
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

function setState(next, detail) {
  state = next;
  document.body.className = `state-${next}`;
  stateLabel.textContent = STATES[next];
  stateDetail.textContent = detail || "";
  if (next !== "loading") {
    progress.hidden = true;
    progressBar.style.width = "0";
    progressBar.classList.remove("indeterminate");
  }
  const busy = next === "loading" || next === "processing";
  processButton.disabled = busy;
  processButton.textContent = next === "processing" ? "Собираю…" : "Обработай";
  if (next === "listening") {
    talk.textContent = "Слушаю";
    talk.disabled = true;
    talk.setAttribute("aria-pressed", "true");
  } else if (busy) {
    talk.textContent = "Говорить";
    talk.disabled = true;
    talk.setAttribute("aria-pressed", "false");
    if (next === "loading") {
      progress.hidden = false;
      if (!progressBar.style.width || progressBar.style.width === "0" || progressBar.style.width === "0%") {
        progressBar.classList.add("indeterminate");
      }
    }
  } else {
    talk.textContent = "Говорить";
    talk.disabled = false;
    talk.setAttribute("aria-pressed", "false");
  }
}

const resultCard = document.getElementById("result");
const listStatus = document.getElementById("list-status");
const ideaList = document.getElementById("idea-list");
const detailDelete = document.getElementById("detail-delete");
let ideas = [];
let openedId = null;
let deleteTimer = null;

document.getElementById("open-list").addEventListener("click", () => {
  showScreen("list");
  loadIdeas();
});
document.getElementById("back-dictate").addEventListener("click", () => showScreen("dictate"));
document.getElementById("result-list").addEventListener("click", () => {
  showScreen("list");
  loadIdeas();
});
document.getElementById("back-list").addEventListener("click", () => showScreen("list"));
document.getElementById("result-share").addEventListener("click", () => {
  if (savedIdea) shareIdea(savedIdea);
});
document.getElementById("detail-share").addEventListener("click", () => {
  const idea = ideas.find((item) => item.id === openedId);
  if (idea) shareIdea(idea);
});
document.getElementById("logout").addEventListener("click", logout);
ideaList.addEventListener("click", onIdeaClick);
detailDelete.addEventListener("click", deleteOpened);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

function showScreen(name) {
  document.getElementById("screen-dictate").hidden = name !== "dictate";
  document.getElementById("screen-list").hidden = name !== "list";
  document.getElementById("screen-detail").hidden = name !== "detail";
}

function hideSaved() {
  savedIdea = null;
  resultCard.hidden = true;
}

function showSaved(idea) {
  savedIdea = idea;
  document.getElementById("result-title").textContent = idea.title;
  document.getElementById("result-body").textContent = idea.body;
  resultCard.hidden = false;
  resultCard.scrollIntoView({ block: "nearest" });
}

function withoutStop(text) {
  return String(text || "").trim().replace(STOP_TAIL, "").trim();
}

function beginProcess() {
  if (finishing) {
    return finishing;
  }
  finishing = runProcess();
  return finishing;
}

async function runProcess() {
  showScreen("dictate");
  hideSaved();
  try {
    if (listening || recognizer) {
      await stopListening({ keepState: true });
    }
    transcript.value = withoutStop(transcript.value);
    const text = transcript.value.trim();
    if (!text) {
      setState("idle", "Пока нечего собирать. Сначала скажите мысль.");
      return;
    }
    setState("processing", "Собираю идею…");
    const idea = await api("/api/ideas", { method: "POST", body: { text } });
    transcript.value = "";
    showSaved(idea);
    setState("idle", "Идея сохранена. Можно диктовать следующую.");
  } catch (error) {
    if (error && error.name === "NeedLogin") {
      return;
    }
    const message = error && error.message ? error.message : "Не получилось собрать идею.";
    setState("error", `${message} Текст на экране сохранён.`);
  } finally {
    dropResults = false;
    finishing = null;
  }
}

function showLogin(message) {
  const note = document.getElementById("login-note");
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  document.getElementById("login-dev").hidden = !local;
  document.getElementById("login-mail").hidden = local;
  if (message) {
    note.textContent = message;
  } else if (local) {
    note.textContent = "На этом компьютере вход без Mail.ru.";
  } else {
    note.textContent = "Войдите ящиком Mail.ru, который указан на сервере.";
  }
  document.getElementById("login").hidden = false;
  document.getElementById("screen-dictate").hidden = true;
  document.getElementById("screen-list").hidden = true;
  document.getElementById("screen-detail").hidden = true;
}

function showApp() {
  document.getElementById("login").hidden = true;
  showScreen("dictate");
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
  showLogin();
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    throw new Error("Сервер не ответил. Проверьте, что он запущен, и повторите.");
  }
  if (response.status === 401) {
    showLogin("Сессия закончилась. Войдите снова.");
    const needLogin = new Error("Нужно войти.");
    needLogin.name = "NeedLogin";
    throw needLogin;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Сервер не смог выполнить запрос.");
  }
  return data;
}

const loginErrors = {
  forbidden: "Этот ящик не открывает диктовку.",
  oauth: "Mail.ru не подтвердил вход. Попробуйте ещё раз.",
};

async function boot() {
  const params = new URLSearchParams(location.search);
  const errorCode = params.get("error");
  if (errorCode) {
    history.replaceState({}, "", location.pathname);
  }
  let user = null;
  try {
    const data = await fetch("/api/auth/me", { credentials: "include" }).then((response) => response.json());
    user = data.user;
  } catch (error) {
    showLogin("Сервер не ответил. Проверьте, что он запущен.");
    return;
  }
  if (!user) {
    showLogin(loginErrors[errorCode] || "");
    return;
  }
  showApp();
}

boot();

async function loadIdeas() {
  listStatus.textContent = "Загружаю идеи…";
  try {
    const data = await api("/api/ideas");
    ideas = data.ideas || [];
    listStatus.textContent = "";
    renderIdeas();
  } catch (error) {
    if (error && error.name === "NeedLogin") {
      listStatus.textContent = "";
      return;
    }
    listStatus.textContent = error.message;
  }
}

function renderIdeas() {
  ideaList.replaceChildren();
  if (!ideas.length) {
    const empty = document.createElement("p");
    empty.className = "lede";
    empty.textContent = "Пока пусто. Надиктуйте мысль и нажмите «Обработай».";
    ideaList.append(empty);
    return;
  }
  ideas.forEach((idea, index) => {
    const card = document.createElement("article");
    card.className = "idea";
    card.dataset.id = idea.id;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "title-button";
    open.dataset.action = "open";
    open.textContent = idea.title;

    const excerpt = document.createElement("p");
    excerpt.className = "excerpt";
    excerpt.textContent = idea.body;

    const when = document.createElement("p");
    when.className = "when";
    when.textContent = formatWhen(idea.createdAt);

    const row = document.createElement("div");
    row.className = "row";
    row.append(
      ideaButton("Выше", "up", index === 0),
      ideaButton("Ниже", "down", index === ideas.length - 1),
      ideaButton("Поделиться", "share", false)
    );
    card.append(open, excerpt, when, row);
    ideaList.append(card);
  });
}

function ideaButton(label, action, disabled) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = action;
  button.textContent = label;
  button.disabled = disabled;
  return button;
}

function onIdeaClick(event) {
  const button = event.target.closest("button");
  if (!button || !button.dataset.action) {
    return;
  }
  const card = button.closest("[data-id]");
  const idea = card && ideas.find((item) => item.id === card.dataset.id);
  if (!idea) {
    return;
  }
  if (button.dataset.action === "open") {
    openDetail(idea);
    return;
  }
  if (button.dataset.action === "share") {
    shareIdea(idea);
    return;
  }
  if (button.dataset.action === "up") {
    moveIdea(idea.id, -1);
    return;
  }
  if (button.dataset.action === "down") {
    moveIdea(idea.id, 1);
  }
}

function openDetail(idea) {
  openedId = idea.id;
  document.getElementById("detail-title").textContent = idea.title;
  document.getElementById("detail-body").textContent = idea.body;
  document.getElementById("detail-source").textContent = idea.sourceText;
  detailDelete.dataset.armed = "0";
  detailDelete.textContent = "Удалить";
  showScreen("detail");
}

async function moveIdea(id, direction) {
  const index = ideas.findIndex((idea) => idea.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ideas.length) {
    return;
  }
  const ids = ideas.map((idea) => idea.id);
  const [moved] = ids.splice(index, 1);
  ids.splice(target, 0, moved);
  try {
    const data = await api("/api/ideas/order", { method: "PUT", body: { ids } });
    ideas = data.ideas || [];
    listStatus.textContent = "";
    renderIdeas();
  } catch (error) {
    listStatus.textContent = error.message;
  }
}

async function deleteOpened() {
  if (!openedId) {
    return;
  }
  if (detailDelete.dataset.armed !== "1") {
    detailDelete.dataset.armed = "1";
    detailDelete.textContent = "Точно удалить?";
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => {
      detailDelete.dataset.armed = "0";
      detailDelete.textContent = "Удалить";
    }, 3000);
    return;
  }
  clearTimeout(deleteTimer);
  const id = openedId;
  detailDelete.disabled = true;
  try {
    await api(`/api/ideas/${encodeURIComponent(id)}`, { method: "DELETE" });
    ideas = ideas.filter((idea) => idea.id !== id);
    openedId = null;
    listStatus.textContent = "";
    showScreen("list");
    renderIdeas();
  } catch (error) {
    listStatus.textContent = error.message;
    showScreen("list");
  } finally {
    detailDelete.disabled = false;
    detailDelete.dataset.armed = "0";
    detailDelete.textContent = "Удалить";
  }
}

async function shareIdea(idea) {
  const text = `${idea.title}\n\n${idea.body}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: idea.title, text });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
    }
  }
  window.location.href = `mailto:?subject=${encodeURIComponent(idea.title)}&body=${encodeURIComponent(idea.body)}`;
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
