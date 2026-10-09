// 마이크 입력을 일정 길이(chunkSize 샘플)로 모아 메인 스레드로 넘기는 AudioWorklet.
// 출력은 무음으로 두고 destination 에 연결해 그래프가 계속 돌게 한다.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.chunkSize = opts.chunkSize || 19200;
    this.levelEvery = opts.levelEvery || 2400; // 50ms @ 48k
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
    this.sumSq = 0;
    this.count = 0;
    this.port.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'chunkSize' && msg.value > 0) {
        this.chunkSize = msg.value | 0;
        this.buffer = new Float32Array(this.chunkSize);
        this.offset = 0;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(ch.length - i, this.chunkSize - this.offset);
      this.buffer.set(ch.subarray(i, i + n), this.offset);
      this.offset += n;
      i += n;
      if (this.offset >= this.chunkSize) {
        const out = this.buffer;
        this.port.postMessage({ type: 'chunk', samples: out }, [out.buffer]);
        this.buffer = new Float32Array(this.chunkSize);
        this.offset = 0;
      }
    }
    for (let k = 0; k < ch.length; k++) this.sumSq += ch[k] * ch[k];
    this.count += ch.length;
    if (this.count >= this.levelEvery) {
      this.port.postMessage({ type: 'level', rms: Math.sqrt(this.sumSq / this.count) });
      this.sumSq = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
