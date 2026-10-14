const MODEL_PATH = "models/vosk-model-small-ru-0.22.tar.gz";
const CACHE = "dictation-v1";
const STATES = {
  idle: "Ожидание",
  loading: "Загрузка распознавателя",
  listening: "Слушаю",
  denied: "Нет доступа к микрофону",
  error: "Ошибка",
};

const talk = document.getElementById("talk");
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

talk.addEventListener("click", onTalk);
copyButton.addEventListener("click", copyText);
clearButton.addEventListener("click", clearText);

if (!window.isSecureContext) {
  setState(
    "error",
    "Микрофон доступен только по HTTPS или на localhost. Откройте эту страницу в Chrome по защищённой ссылке."
  );
}

function onTalk() {
  if (state === "listening") {
    stopListening();
    return;
  }
  if (state === "loading") {
    return;
  }
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
  setState("listening", "Говорите. Текст появляется ниже.");
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
  const text = message && message.result && message.result.text ? message.result.text.trim() : "";
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
  if (stopFlush) {
    const finish = stopFlush;
    stopFlush = null;
    finish();
  }
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

function stopListening() {
  listening = false;
  teardownAudio();
  if (lastPartial) {
    appendText(lastPartial);
    parkedPartial = lastPartial;
    lastPartial = "";
    interim.textContent = "";
  }
  const current = recognizer;
  if (!current) {
    interim.textContent = "";
    setState("idle", idleDetail());
    return;
  }
  const flushed = new Promise((resolve) => {
    stopFlush = resolve;
    setTimeout(resolve, 1500);
  });
  try {
    current.retrieveFinalResult();
  } catch (error) {
    if (stopFlush) {
      stopFlush();
      stopFlush = null;
    }
  }
  flushed.then(() => {
    try {
      current.remove();
    } catch (error) {
      /* recognizer already gone */
    }
    if (state === "idle") {
      interim.textContent = "";
      parkedPartial = "";
    }
  });
  recognizer = null;
  setState("idle", idleDetail());
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
    ? "Модель на телефоне. Можно говорить без сети."
    : "Первый запуск скачает модель, около 44 МБ. Потом диктовка работает без сети.";
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
  if (!transcript.value && !interim.textContent) {
    return;
  }
  if (clearButton.dataset.armed === "1") {
    transcript.value = "";
    interim.textContent = "";
    disarmClear();
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
  if (next === "listening") {
    talk.textContent = "Стоп";
    talk.disabled = false;
    talk.setAttribute("aria-pressed", "true");
  } else if (next === "loading") {
    talk.textContent = "Загрузка…";
    talk.disabled = true;
    talk.setAttribute("aria-pressed", "false");
    progress.hidden = false;
    if (!progressBar.style.width || progressBar.style.width === "0" || progressBar.style.width === "0%") {
      progressBar.classList.add("indeterminate");
    }
  } else if (next === "error") {
    talk.textContent = "Повторить";
    talk.disabled = false;
    talk.setAttribute("aria-pressed", "false");
  } else {
    talk.textContent = "Говорить";
    talk.disabled = false;
    talk.setAttribute("aria-pressed", "false");
  }
}
