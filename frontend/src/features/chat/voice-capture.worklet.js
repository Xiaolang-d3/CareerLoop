// Run capture outside the UI thread. Output remains silent to avoid mic echo.
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(Math.round(sampleRate / 10));
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index];
      this.buffer[this.offset++] = sample / channels.length;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(Math.round(sampleRate / 10));
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("voice-capture", VoiceCaptureProcessor);
