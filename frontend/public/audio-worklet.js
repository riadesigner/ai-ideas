class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      return true;
    }

    let index = 0;
    while (index < channel.length) {
      const space = this.buffer.length - this.offset;
      const take = Math.min(space, channel.length - index);
      this.buffer.set(channel.subarray(index, index + take), this.offset);
      this.offset += take;
      index += take;
      if (this.offset === this.buffer.length) {
        const copy = new Float32Array(this.buffer);
        this.port.postMessage(copy, [copy.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
