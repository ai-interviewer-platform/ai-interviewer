var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/eventemitter3/index.js
var require_eventemitter3 = __commonJS({
  "node_modules/eventemitter3/index.js"(exports, module) {
    "use strict";
    var has = Object.prototype.hasOwnProperty;
    var prefix = "~";
    function Events() {
    }
    if (Object.create) {
      Events.prototype = /* @__PURE__ */ Object.create(null);
      if (!new Events().__proto__) prefix = false;
    }
    function EE(fn, context, once) {
      this.fn = fn;
      this.context = context;
      this.once = once || false;
    }
    function addListener(emitter, event, fn, context, once) {
      if (typeof fn !== "function") {
        throw new TypeError("The listener must be a function");
      }
      var listener = new EE(fn, context || emitter, once), evt = prefix ? prefix + event : event;
      if (!emitter._events[evt]) emitter._events[evt] = listener, emitter._eventsCount++;
      else if (!emitter._events[evt].fn) emitter._events[evt].push(listener);
      else emitter._events[evt] = [emitter._events[evt], listener];
      return emitter;
    }
    function clearEvent(emitter, evt) {
      if (--emitter._eventsCount === 0) emitter._events = new Events();
      else delete emitter._events[evt];
    }
    function EventEmitter2() {
      this._events = new Events();
      this._eventsCount = 0;
    }
    EventEmitter2.prototype.eventNames = function eventNames() {
      var names = [], events, name;
      if (this._eventsCount === 0) return names;
      for (name in events = this._events) {
        if (has.call(events, name)) names.push(prefix ? name.slice(1) : name);
      }
      if (Object.getOwnPropertySymbols) {
        return names.concat(Object.getOwnPropertySymbols(events));
      }
      return names;
    };
    EventEmitter2.prototype.listeners = function listeners(event) {
      var evt = prefix ? prefix + event : event, handlers = this._events[evt];
      if (!handlers) return [];
      if (handlers.fn) return [handlers.fn];
      for (var i = 0, l = handlers.length, ee = new Array(l); i < l; i++) {
        ee[i] = handlers[i].fn;
      }
      return ee;
    };
    EventEmitter2.prototype.listenerCount = function listenerCount(event) {
      var evt = prefix ? prefix + event : event, listeners = this._events[evt];
      if (!listeners) return 0;
      if (listeners.fn) return 1;
      return listeners.length;
    };
    EventEmitter2.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt]) return false;
      var listeners = this._events[evt], len = arguments.length, args, i;
      if (listeners.fn) {
        if (listeners.once) this.removeListener(event, listeners.fn, void 0, true);
        switch (len) {
          case 1:
            return listeners.fn.call(listeners.context), true;
          case 2:
            return listeners.fn.call(listeners.context, a1), true;
          case 3:
            return listeners.fn.call(listeners.context, a1, a2), true;
          case 4:
            return listeners.fn.call(listeners.context, a1, a2, a3), true;
          case 5:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
          case 6:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
        }
        for (i = 1, args = new Array(len - 1); i < len; i++) {
          args[i - 1] = arguments[i];
        }
        listeners.fn.apply(listeners.context, args);
      } else {
        var length = listeners.length, j;
        for (i = 0; i < length; i++) {
          if (listeners[i].once) this.removeListener(event, listeners[i].fn, void 0, true);
          switch (len) {
            case 1:
              listeners[i].fn.call(listeners[i].context);
              break;
            case 2:
              listeners[i].fn.call(listeners[i].context, a1);
              break;
            case 3:
              listeners[i].fn.call(listeners[i].context, a1, a2);
              break;
            case 4:
              listeners[i].fn.call(listeners[i].context, a1, a2, a3);
              break;
            default:
              if (!args) for (j = 1, args = new Array(len - 1); j < len; j++) {
                args[j - 1] = arguments[j];
              }
              listeners[i].fn.apply(listeners[i].context, args);
          }
        }
      }
      return true;
    };
    EventEmitter2.prototype.on = function on(event, fn, context) {
      return addListener(this, event, fn, context, false);
    };
    EventEmitter2.prototype.once = function once(event, fn, context) {
      return addListener(this, event, fn, context, true);
    };
    EventEmitter2.prototype.removeListener = function removeListener(event, fn, context, once) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt]) return this;
      if (!fn) {
        clearEvent(this, evt);
        return this;
      }
      var listeners = this._events[evt];
      if (listeners.fn) {
        if (listeners.fn === fn && (!once || listeners.once) && (!context || listeners.context === context)) {
          clearEvent(this, evt);
        }
      } else {
        for (var i = 0, events = [], length = listeners.length; i < length; i++) {
          if (listeners[i].fn !== fn || once && !listeners[i].once || context && listeners[i].context !== context) {
            events.push(listeners[i]);
          }
        }
        if (events.length) this._events[evt] = events.length === 1 ? events[0] : events;
        else clearEvent(this, evt);
      }
      return this;
    };
    EventEmitter2.prototype.removeAllListeners = function removeAllListeners(event) {
      var evt;
      if (event) {
        evt = prefix ? prefix + event : event;
        if (this._events[evt]) clearEvent(this, evt);
      } else {
        this._events = new Events();
        this._eventsCount = 0;
      }
      return this;
    };
    EventEmitter2.prototype.off = EventEmitter2.prototype.removeListener;
    EventEmitter2.prototype.addListener = EventEmitter2.prototype.on;
    EventEmitter2.prefixed = prefix;
    EventEmitter2.EventEmitter = EventEmitter2;
    if ("undefined" !== typeof module) {
      module.exports = EventEmitter2;
    }
  }
});

// node_modules/eventemitter3/index.mjs
var import_index = __toESM(require_eventemitter3(), 1);

// node_modules/@deepgram/agents/dist/index.js
var a = class {
  constructor(t, e = {}) {
    this.onAudioFrame = t, this.options = e, this.ctx = null, this.stream = null, this.workletNode = null, this.workletBlobUrl = null, this.analyser = null, this.listeners = /* @__PURE__ */ new Map(), this._muted = false;
  }
  get muted() {
    return this._muted;
  }
  getInputVolume() {
    if (!this.analyser) return 0;
    const t = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(t);
    let e = 0;
    for (let i = 0; i < t.length; i++) {
      const s = (t[i] - 128) / 128;
      e += s * s;
    }
    return Math.min(1, 4 * Math.sqrt(e / t.length));
  }
  getInputByteFrequencyData() {
    if (!this.analyser) return new Uint8Array(0);
    const t = new Uint8Array(this.analyser.frequencyBinCount);
    return this.analyser.getByteFrequencyData(t), t;
  }
  async start() {
    if (this.stream) return;
    const { sampleRate: t = 16e3, echoCancellation: e = true, noiseSuppression: i = true, autoGainControl: s = true } = this.options;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: e, noiseSuppression: i, autoGainControl: s } }), this.ctx = new AudioContext({ sampleRate: t }), await this.ctx.resume(), this.analyser = this.ctx.createAnalyser(), this.analyser.fftSize = 256, this.workletBlobUrl = (function() {
      const t2 = new Blob(["\nclass PCMCaptureProcessor extends AudioWorkletProcessor {\n  constructor() {\n    super();\n    this._active = true;\n    this.port.onmessage = (e) => {\n      if (e.data === 'stop') this._active = false;\n    };\n  }\n\n  process(inputs) {\n    if (!this._active) return false;\n    const channel = inputs[0]?.[0];\n    if (!channel) return true;\n\n    const int16 = new Int16Array(channel.length);\n    for (let i = 0; i < channel.length; i++) {\n      const clamped = Math.max(-1, Math.min(1, channel[i]));\n      int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;\n    }\n    this.port.postMessage(int16.buffer, [int16.buffer]);\n    return true;\n  }\n}\n\nregisterProcessor('dg-pcm-capture', PCMCaptureProcessor);\n"], { type: "application/javascript" });
      return URL.createObjectURL(t2);
    })(), await this.ctx.audioWorklet.addModule(this.workletBlobUrl);
    const n = this.ctx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.ctx, "dg-pcm-capture"), this.workletNode.port.onmessage = (t2) => {
      this._muted || (this.onAudioFrame(t2.data), this._emit("audio-frame", t2.data));
    }, n.connect(this.analyser), n.connect(this.workletNode);
  }
  stop() {
    this.workletNode && (this.workletNode.port.postMessage("stop"), this.workletNode.disconnect(), this.workletNode = null), this.analyser = null, this.ctx && (this.ctx.close().catch(() => null), this.ctx = null), this.workletBlobUrl && (URL.revokeObjectURL(this.workletBlobUrl), this.workletBlobUrl = null), this.stream && (this.stream.getTracks().forEach((t) => t.stop()), this.stream = null);
  }
  mute() {
    this._muted = true;
  }
  unmute() {
    this._muted = false;
  }
  on(t, e) {
    return this.listeners.has(t) || this.listeners.set(t, /* @__PURE__ */ new Set()), this.listeners.get(t).add(e), this;
  }
  off(t, e) {
    return this.listeners.get(t)?.delete(e), this;
  }
  _emit(t, ...e) {
    this.listeners.get(t)?.forEach((t2) => t2(...e));
  }
};
var r = class {
  constructor(t = {}) {
    this.options = t, this.ctx = null, this.analyser = null, this.gainNode = null, this.nextStartTime = 0, this._muted = false, this._volume = 1;
  }
  get muted() {
    return this._muted;
  }
  get volume() {
    return this._volume;
  }
  setVolume(t) {
    this._volume = Math.max(0, Math.min(1, t)), this.gainNode && (this.gainNode.gain.value = this._volume);
  }
  getOutputVolume() {
    if (!this.analyser) return 0;
    const t = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(t);
    let e = 0;
    for (let i = 0; i < t.length; i++) {
      const s = (t[i] - 128) / 128;
      e += s * s;
    }
    return Math.min(1, 4 * Math.sqrt(e / t.length));
  }
  getOutputByteFrequencyData() {
    if (!this.analyser) return new Uint8Array(0);
    const t = new Uint8Array(this.analyser.frequencyBinCount);
    return this.analyser.getByteFrequencyData(t), t;
  }
  queue(t) {
    if (this._muted) return;
    const e = this._ensureContext(), i = this.options.sampleRate ?? 24e3, s = new Int16Array(t), n = new Float32Array(s.length);
    for (let c = 0; c < s.length; c++) n[c] = s[c] / (s[c] < 0 ? 32768 : 32767);
    const o = e.createBuffer(1, n.length, i);
    o.copyToChannel(n, 0);
    const a2 = e.createBufferSource();
    a2.buffer = o, a2.connect(this.gainNode);
    const r2 = Math.max(e.currentTime, this.nextStartTime);
    a2.start(r2), this.nextStartTime = r2 + o.duration;
  }
  getRemainingPlaybackTime() {
    return this.ctx ? Math.max(0, this.nextStartTime - this.ctx.currentTime) : 0;
  }
  interrupt() {
    this.ctx && (this.ctx.close().catch(() => null), this.ctx = null, this.analyser = null, this.gainNode = null, this.nextStartTime = 0);
  }
  mute() {
    this._muted = true, this.interrupt();
  }
  unmute() {
    this._muted = false;
  }
  dispose() {
    this.ctx?.close().catch(() => null), this.ctx = null, this.analyser = null, this.gainNode = null;
  }
  _ensureContext() {
    return this.ctx && "closed" !== this.ctx.state || (this.ctx = new AudioContext({ sampleRate: this.options.sampleRate ?? 24e3 }), this.nextStartTime = 0, this.gainNode = this.ctx.createGain(), this.gainNode.gain.value = this._volume, this.analyser = this.ctx.createAnalyser(), this.analyser.fftSize = 256, this.gainNode.connect(this.analyser), this.analyser.connect(this.ctx.destination)), "suspended" === this.ctx.state && this.ctx.resume().catch(() => null), this.ctx;
  }
};

// src/browser/voice-agent.js
var VOICE_PROVIDER = "deepgram";
var THINKING_MODEL = "gpt-5.6-terra";
function createDeepgramVoiceSession({ attempt, onStatus, onTranscript, onError }) {
  let microphone;
  let player;
  let socket;
  let keepAlive;
  const stop = () => {
    clearInterval(keepAlive);
    microphone?.stop();
    microphone = void 0;
    const connection = socket;
    socket = void 0;
    connection?.close();
    player?.dispose();
    player = void 0;
    onStatus("stopped");
  };
  const fail = (error) => {
    stop();
    onError(error instanceof Error ? error : new Error("Voice connection ended."));
  };
  return {
    async start() {
      if (socket) return;
      onStatus("connecting");
      player = new r({ sampleRate: 24e3 });
      const url = new URL(`/api/attempts/${encodeURIComponent(attempt.id)}/voice`, location.origin);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const connection = new WebSocket(url);
      socket = connection;
      connection.binaryType = "arraybuffer";
      connection.onclose = () => {
        if (socket === connection) fail(new Error("Voice session ended. Your recorded transcript is saved."));
      };
      connection.onerror = fail;
      connection.onmessage = async ({ data }) => {
        if (socket !== connection) return;
        if (typeof data !== "string") {
          player?.queue(data);
          return;
        }
        try {
          const message = JSON.parse(data);
          if (message.type === "SettingsApplied") {
            const capture = new a((frame) => {
              if (socket?.readyState === WebSocket.OPEN) socket.send(frame);
            }, { sampleRate: 16e3 });
            microphone = capture;
            capture.on("error", fail);
            await capture.start();
            if (socket !== connection) {
              capture.stop();
              return;
            }
            keepAlive = setInterval(() => {
              if (socket?.readyState === WebSocket.OPEN) socket.send('{"type":"KeepAlive"}');
            }, 1e4);
            onStatus("listening");
          } else if (message.type === "ConversationText") await onTranscript({ role: message.role, text: message.content });
          else if (message.type === "UserStartedSpeaking") {
            player?.interrupt();
            onStatus("listening");
          } else if (message.type === "AgentThinking") onStatus("thinking");
          else if (message.type === "AgentStartedSpeaking") onStatus("speaking");
          else if (message.type === "AgentAudioDone") onStatus("listening");
          else if (message.type === "Error") fail(new Error("Voice provider could not continue."));
        } catch (error) {
          fail(error);
        }
      };
    },
    stop,
    sendText(content) {
      if (socket?.readyState !== WebSocket.OPEN) throw new Error("Start voice before sending a message.");
      socket.send(JSON.stringify({ type: "InjectUserMessage", content }));
    },
    get active() {
      return Boolean(socket);
    }
  };
}
export {
  THINKING_MODEL,
  VOICE_PROVIDER,
  createDeepgramVoiceSession
};
