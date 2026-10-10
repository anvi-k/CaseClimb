"use strict";

// Integrate each input sample over its share of a 16 kHz output sample. The
// accumulator survives render quanta, including nonintegral 44.1 kHz ratios.
class CaseClimbMicrophone extends AudioWorkletProcessor {
  constructor() {
    super(); this.ratio = sampleRate / 16000; this.weight = 0; this.sum = 0;
    this.packet = new Int16Array(1600); this.offset = 0;
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const input = inputs[0]?.[0]; if (!input) return true;
    for (const value of input) {
      let remaining = 1;
      while (remaining > 0) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * take; this.weight += take; remaining -= take;
        if (this.weight >= this.ratio - 1e-9) {
          const sample = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.packet[this.offset++] = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)));
          this.weight = 0; this.sum = 0;
          if (this.offset === this.packet.length) {
            this.port.postMessage(this.packet.buffer, [this.packet.buffer]);
            this.packet = new Int16Array(1600); this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor("caseclimb-microphone", CaseClimbMicrophone);
