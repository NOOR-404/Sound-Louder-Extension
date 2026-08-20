(function () {
  'use strict';

  if (window.__Noor404Extreme_loaded) return;
  window.__Noor404Extreme_loaded = true;

  window.addEventListener('click', () => {
    if (window.__Noor404AudioCtx && window.__Noor404AudioCtx.state === 'suspended') {
      window.__Noor404AudioCtx.resume();
    }
  }, { once: true });

  window.addEventListener('touchstart', () => {
    if (window.__Noor404AudioCtx && window.__Noor404AudioCtx.state === 'suspended') {
      window.__Noor404AudioCtx.resume();
    }
  }, { once: true });

  const DEFAULT_CONFIG = Object.freeze({
    clearGain: 200,
    masterGain: 1000,
    rageBoost: 0,
    bitrate: 2500,
    stereoWidth: 1.0,
    eq1: 0,
    eq2: 0,
    eq3: 0,
    eq4: 0,
    eq5: 0,
    eq6: 0,
    customColor: "#ff0000",
    turboActive: false,
    muteActive: false,
    panelLocked: false,
    collapsed: false,
    panelX: 20,
    panelY: 20
  });

  const currentState = Object.seal({ ...DEFAULT_CONFIG });

  let saveStateTimeout = null;
  function debouncedSaveState() {
    if (saveStateTimeout) clearTimeout(saveStateTimeout);
    saveStateTimeout = setTimeout(saveStateToLocalStorage, 200);
  }

  function loadStateFromLocalStorage() {
    try {
      const saved = localStorage.getItem("noor404-extreme-hybrid-state");
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== "object") return;

      if (typeof parsed.clearGain === "number") {
        currentState.clearGain = Math.min(500, Math.max(1, parsed.clearGain));
      }
      if (typeof parsed.masterGain === "number") {
        currentState.masterGain = Math.min(100000, Math.max(1, parsed.masterGain));
      }
      if (typeof parsed.rageBoost === "number") {
        currentState.rageBoost = Math.min(100000, Math.max(0, parsed.rageBoost));
      }
      if (typeof parsed.bitrate === "number") {
        currentState.bitrate = Math.min(2500, Math.max(1, parsed.bitrate));
      }
      if (typeof parsed.stereoWidth === "number") {
        currentState.stereoWidth = Math.min(2, Math.max(0, parsed.stereoWidth));
      }
      if (parsed.customColor) {
        currentState.customColor = parsed.customColor;
      }

      for (let i = 1; i <= 6; i++) {
        if (typeof parsed[`eq${i}`] === "number") {
          currentState[`eq${i}`] = Math.min(24, Math.max(-24, parsed[`eq${i}`]));
        }
      }

      currentState.turboActive = Boolean(parsed.turboActive);
      currentState.muteActive = Boolean(parsed.muteActive);
      currentState.panelLocked = Boolean(parsed.panelLocked);
      currentState.collapsed = Boolean(parsed.collapsed);

      if (typeof parsed.panelX === "number") {
        currentState.panelX = Math.max(0, parsed.panelX);
      }
      if (typeof parsed.panelY === "number") {
        currentState.panelY = Math.max(0, parsed.panelY);
      }
    } catch (e) {
    }
  }

  function saveStateToLocalStorage() {
    try {
      localStorage.setItem("noor404-extreme-hybrid-state", JSON.stringify(currentState));
    } catch (e) {
    }
  }

  loadStateFromLocalStorage();

  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
  let workletPromise = null;

  window.AudioContext = class extends NativeAudioContext {
    constructor(opts) {
      super(opts || { latencyHint: "interactive", sampleRate: 48000 });
      window.__Noor404AudioCtx = this;

      const workletCode = `
        class Noor404Processor extends AudioWorkletProcessor {
            constructor() {
                super();
                this._dcX = new Float32Array(8);
                this._dcY = new Float32Array(8);
            }

            static get parameterDescriptors() {
                return [
                    { name: 'clearGain', defaultValue: 200.0, minValue: 1, maxValue: 500 },
                    { name: 'masterGain', defaultValue: 1000.0, minValue: 0, maxValue: 100000 },
                    { name: 'rage', defaultValue: 0.0, minValue: 0, maxValue: 100000 },
                    { name: 'bitrate', defaultValue: 2500, minValue: 1, maxValue: 2500 },
                    { name: 'width', defaultValue: 1.0, minValue: 0, maxValue: 2 },
                    { name: 'mute', defaultValue: 0, minValue: 0, maxValue: 1 },
                ];
            }

            extremeTanh(x) {
                return Math.tanh(x * 16.0);
            }

            process(inputs, outputs, params) {
                const input = inputs[0];
                const output = outputs[0];
                if (!input || !input.length || !input[0].length) return true;

                const channelCount = input.length;
                const frameLength = input[0].length;
                const hasStereo = channelCount >= 2;

                for (let i = 0; i < frameLength; i++) {
                    const clearGain = params.clearGain.length > 1 ? params.clearGain[i] : params.clearGain[0];
                    const masterGain = params.masterGain.length > 1 ? params.masterGain[i] : params.masterGain[0];
                    const rage = params.rage.length > 1 ? params.rage[i] : params.rage[0];
                    const bitrate = params.bitrate.length > 1 ? params.bitrate[i] : params.bitrate[0];
                    const widthVal = params.width.length > 1 ? params.width[i] : params.width[0];
                    const mute = params.mute.length > 1 ? params.mute[i] : params.mute[0];

                    const megaBoost = (masterGain) * (1.0 + Math.pow(rage / 10, 2.0));
                    const step = 1 / (bitrate / 20);

                    const processed = new Array(channelCount);

                    for (let ch = 0; ch < channelCount; ch++) {
                        let s = input[ch][i];

                        if (mute > 0.5) {
                            processed[ch] = 0;
                            continue;
                        }

                        s *= clearGain;

                        if (bitrate < 2500) {
                            s = Math.round(s / step) * step;
                        }

                        s *= megaBoost;
                        s = this.extremeTanh(s);

                        s *= 500.0; 
                        s = Math.max(-0.9999, Math.min(0.9999, s));
                        processed[ch] = s;
                    }

                    if (hasStereo) {
                        const L = processed[0];
                        const R = processed[1];
                        const mid = (L + R) * 0.5;
                        const side = (L - R) * 0.5;
                        processed[0] = Math.max(-0.9999, Math.min(0.9999, mid + side * widthVal));
                        processed[1] = Math.max(-0.9999, Math.min(0.9999, mid - side * widthVal));
                    }

                    for (let ch = 0; ch < channelCount; ch++) {
                        output[ch][i] = processed[ch];
                    }
                }
                return true;
            }
        }
        registerProcessor('noor404-processor', Noor404Processor);
      `;

      const blobUrl = URL.createObjectURL(new Blob([workletCode], { type: "application/javascript" }));
      workletPromise = this.audioWorklet.addModule(blobUrl)
        .then(() => {
          URL.revokeObjectURL(blobUrl);
          if (window.__Noor404PanelReady) {
            window.__Noor404PanelReady.setStatus("ULTIMATE SOUND ONLINE");
          }
        })
        .catch(() => {
          if (window.__Noor404PanelReady) {
            window.__Noor404PanelReady.setStatus("WORKLET FAIL");
          }
        });
    }
  };
  Object.defineProperty(window.AudioContext, "name", { value: "AudioContext" });

  function forceStereoOpusSDP(sdp) {
    const match = sdp.match(/a=rtpmap:(\d+) opus\/48000/);
    if (!match) return sdp;

    const payloadType = match[1];
    const fmtpRegex = new RegExp(`a=fmtp:${payloadType} [^\\r\\n]+`);
    const customFmtp = `a=fmtp:${payloadType} minptime=10;useinbandfec=1;usedtx=0;stereo=1;maxaveragebitrate=510000;maxplaybackrate=48000;sprop-maxcapturerate=48000;cbr=1`;

    if (fmtpRegex.test(sdp)) {
      sdp = sdp.replace(fmtpRegex, customFmtp);
    } else {
      sdp = sdp.replace(new RegExp(`(a=rtpmap:${payloadType} opus\\/48000\\/2)`), `$1\r\n${customFmtp}`);
    }
    return sdp.replace(/b=AS:\d+/g, "b=AS:510");
  }

  const NativePeerConnection = window.RTCPeerConnection;
  if (NativePeerConnection) {
    window.RTCPeerConnection = class extends NativePeerConnection {
      async createOffer(options) {
        const offer = await super.createOffer(options);
        offer.sdp = forceStereoOpusSDP(offer.sdp);
        return offer;
      }
      async createAnswer(options) {
        const answer = await super.createAnswer(options);
        answer.sdp = forceStereoOpusSDP(answer.sdp);
        return answer;
      }
      async setLocalDescription(desc) {
        if (desc && desc.sdp) {
          desc = new RTCSessionDescription({ type: desc.type, sdp: forceStereoOpusSDP(desc.sdp) });
        }
        return super.setLocalDescription(desc);
      }
      async setRemoteDescription(desc) {
        if (desc && desc.sdp) {
          desc = new RTCSessionDescription({ type: desc.type, sdp: forceStereoOpusSDP(desc.sdp) });
        }
        return super.setRemoteDescription(desc);
      }
    };
    Object.defineProperty(window.RTCPeerConnection, "name", { value: "RTCPeerConnection" });
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      if (constraints && constraints.audio) {
        constraints.audio = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 48000,
          sampleSize: 16
        };
      }
      const stream = await origGetUserMedia(constraints);
      if (constraints && constraints.audio && stream.getAudioTracks().length > 0) {
        return await AudioInterceptor.intercept(stream);
      }
      return stream;
    };
  }

  const AudioInterceptor = {
    workletNode: null,
    analyserNode: null,
    sourceNode: null,
    eqNodes: [],
    pushScheduled: false,

    async intercept(mediaStream) {
      let audioCtx = window.__Noor404AudioCtx;
      if (!audioCtx) {
        audioCtx = new window.AudioContext();
      }

      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      if (workletPromise) {
        await workletPromise;
      }

      this.cleanup();

      const source = audioCtx.createMediaStreamSource(mediaStream);
      const destination = audioCtx.createMediaStreamDestination();

      try {
        this.sourceNode = source;
        this.workletNode = new AudioWorkletNode(audioCtx, "noor404-processor");
        
        const freqs = [100, 250, 1000, 3000, 6000, 12000];
        const types = ["lowshelf", "peaking", "peaking", "peaking", "peaking", "highshelf"];

        this.eqNodes = freqs.map((freq, i) => {
          const filter = audioCtx.createBiquadFilter();
          filter.type = types[i];
          filter.frequency.value = freq;
          return filter;
        });

        source.connect(this.workletNode);
        let lastNode = this.workletNode;
        for (const eqNode of this.eqNodes) {
          lastNode.connect(eqNode);
          lastNode = eqNode;
        }

        this.analyserNode = audioCtx.createAnalyser();
        this.analyserNode.fftSize = 512;
        lastNode.connect(this.analyserNode);
        this.analyserNode.connect(destination);

        window.__Noor404Analyser = this.analyserNode;

        this.pushParamsFast();
        return destination.stream;
      } catch (err) {
        if (window.__Noor404PanelReady) {
          window.__Noor404PanelReady.setStatus("FALLBACK MIC");
        }
        return mediaStream;
      }
    },

    cleanup() {
      try {
        if (this.sourceNode) this.sourceNode.disconnect();
      } catch (e) {}
      try {
        if (this.workletNode) this.workletNode.disconnect();
      } catch (e) {}
      try {
        this.eqNodes.forEach(n => n.disconnect());
      } catch (e) {}
      try {
        if (this.analyserNode) this.analyserNode.disconnect();
      } catch (e) {}

      this.sourceNode = null;
      this.workletNode = null;
      this.analyserNode = null;
      this.eqNodes = [];
      window.__Noor404Analyser = null;
    },

    schedulePushParams() {
      if (this.pushScheduled) return;
      this.pushScheduled = true;
      requestAnimationFrame(() => {
        this.pushScheduled = false;
        this.pushParamsFast();
      });
    },

    pushParamsFast() {
      if (!this.workletNode || !window.__Noor404AudioCtx) return;

      const params = this.workletNode.parameters;
      const now = window.__Noor404AudioCtx.currentTime;

      let cGain = currentState.clearGain;
      let mGain = currentState.turboActive ? 100000 : currentState.masterGain;
      let rage = currentState.turboActive ? 100000 : currentState.rageBoost;
      let bitrate = currentState.bitrate;
      let width = currentState.stereoWidth;
      let mute = currentState.muteActive ? 1 : 0;

      let statusMsg = "MAX LOUDNESS ACTIVE";
      if (currentState.muteActive) {
        statusMsg = "MUTED";
      } else if (currentState.turboActive) {
        statusMsg = "ULTIMATE TURBO BOOST";
      }

      params.get("clearGain").setValueAtTime(cGain, now);
      params.get("masterGain").setValueAtTime(mGain, now);
      params.get("rage").setValueAtTime(rage, now);
      params.get("bitrate").setValueAtTime(bitrate, now);
      params.get("width").setValueAtTime(width, now);
      params.get("mute").setValueAtTime(mute, now);

      if (this.eqNodes.length === 6) {
        for (let i = 0; i < 6; i++) {
          this.eqNodes[i].gain.setValueAtTime(currentState[`eq${i + 1}`], now);
        }
      }

      if (window.__Noor404PanelReady) {
        window.__Noor404PanelReady.setStatus(statusMsg);
      }
    }
  };

  const UIController = {
    bgParticles: [],

    init() {
      this.injectStyles();
      this.build();
      this.bind();
      this.enableDrag();
      this.initColorPalette();
      this.applyCustomColor(currentState.customColor || "#ff0000");
      this.applyFromState();
      this.setStatus("MAX POWER");

      window.__Noor404PanelReady = this;
      this.initBgParticles();
      this.startBgParticlesAnimation();
      this.startVisualizer();
    },

    resetToDefaults() {
      currentState.clearGain = DEFAULT_CONFIG.clearGain;
      currentState.masterGain = DEFAULT_CONFIG.masterGain;
      currentState.rageBoost = DEFAULT_CONFIG.rageBoost;
      currentState.bitrate = DEFAULT_CONFIG.bitrate;
      currentState.stereoWidth = DEFAULT_CONFIG.stereoWidth;
      
      currentState.eq1 = DEFAULT_CONFIG.eq1;
      currentState.eq2 = DEFAULT_CONFIG.eq2;
      currentState.eq3 = DEFAULT_CONFIG.eq3;
      currentState.eq4 = DEFAULT_CONFIG.eq4;
      currentState.eq5 = DEFAULT_CONFIG.eq5;
      currentState.eq6 = DEFAULT_CONFIG.eq6;
      
      currentState.turboActive = false;

      this.applyFromState();
      AudioInterceptor.pushParamsFast();
      saveStateToLocalStorage();
    },

    initBgParticles() {
      this.bgParticles = [];
      for (let i = 0; i < 40; i++) {
        this.bgParticles.push({
          x: Math.random() * 300,
          y: Math.random() * 550,
          r: Math.random() * 1.8 + 0.5,
          speed: Math.random() * 0.5 + 0.1,
          opacity: Math.random() * 0.6 + 0.2
        });
      }
    },

    startBgParticlesAnimation() {
      const canvas = document.getElementById("n404-bg-canvas");
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      const renderBg = () => {
        requestAnimationFrame(renderBg);
        const panel = document.getElementById("n404-panel");
        const w = canvas.width = panel.offsetWidth || 300;
        const h = canvas.height = panel.offsetHeight || 550;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';

        this.bgParticles.forEach(p => {
          p.y -= p.speed;
          if (p.y < 0) p.y = h;
          ctx.globalAlpha = p.opacity;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1.0;
      };
      renderBg();
    },

    startVisualizer() {
      const canvas = document.getElementById("n404-canvas");
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      const render = () => {
        requestAnimationFrame(render);
        if (currentState.collapsed) return;

        const width = canvas.width = canvas.offsetWidth || 280;
        const height = canvas.height = canvas.offsetHeight || 50;

        ctx.clearRect(0, 0, width, height);

        const analyser = window.__Noor404Analyser;
        if (analyser) {
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyser.getByteFrequencyData(dataArray);

          const barWidth = (width / bufferLength) * 2;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * height;
            ctx.fillStyle = currentState.customColor || '#ff0000';
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
          }
        } else {
          ctx.fillStyle = currentState.customColor || '#ff0000';
          ctx.fillRect(0, height / 2, width, 2);
        }
      };
      render();
    },

    setStatus(text) {
      const el = document.getElementById("n404-status");
      if (el) el.textContent = text;
    },

    applyCustomColor(colorHex) {
      currentState.customColor = colorHex;
      const panel = document.getElementById("n404-panel");
      if (panel) {
        panel.style.setProperty('--accent', colorHex);
        panel.style.setProperty('--border', colorHex);
      }
      saveStateToLocalStorage();
    },

    initColorPalette() {
      const canvas = document.getElementById("n404-palette-canvas");
      const dot = document.getElementById("n404-color-dot");
      if (!canvas || !dot) return;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const w = canvas.width = 250;
      const h = canvas.height = 30;

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "hsl(0, 100%, 50%)");
      grad.addColorStop(0.17, "hsl(60, 100%, 50%)");
      grad.addColorStop(0.33, "hsl(120, 100%, 50%)");
      grad.addColorStop(0.5, "hsl(180, 100%, 50%)");
      grad.addColorStop(0.67, "hsl(240, 100%, 50%)");
      grad.addColorStop(0.83, "hsl(300, 100%, 50%)");
      grad.addColorStop(1, "hsl(360, 100%, 50%)");

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      let isSelecting = false;

      const pickColor = (clientX) => {
        const rect = canvas.getBoundingClientRect();
        let x = Math.min(Math.max(0, clientX - rect.left), rect.width);
        const scaleX = w / rect.width;
        const pxX = Math.min(Math.max(0, Math.floor(x * scaleX)), w - 1);

        const pixel = ctx.getImageData(pxX, 15, 1, 1).data;
        const hex = "#" + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1);

        dot.style.left = `${x}px`;
        this.applyCustomColor(hex);
      };

      const handleStart = (e) => {
        isSelecting = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        pickColor(clientX);
      };

      const handleMove = (e) => {
        if (!isSelecting) return;
        if (e.cancelable) e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        pickColor(clientX);
      };

      const handleEnd = () => { isSelecting = false; };

      canvas.parentElement.addEventListener("mousedown", handleStart);
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleEnd);

      canvas.parentElement.addEventListener("touchstart", handleStart, { passive: false });
      window.addEventListener("touchmove", handleMove, { passive: false });
      window.addEventListener("touchend", handleEnd);
    },

    updateValueLabel(key) {
      const lbl = document.getElementById("lbl-" + key);
      if (!lbl) return;
      let val = currentState[key];
      if (key === "clearGain" || key === "masterGain") {
        val = val.toFixed(0) + 'x';
      } else if (key === "rageBoost") {
        val = val + '%';
      } else if (key === "stereoWidth") {
        val = val.toFixed(2) + 'x';
      } else if (key.startsWith("eq")) {
        val = (val > 0 ? "+" : "") + val.toFixed(1) + "dB";
      }
      lbl.textContent = val;
    },

    applyFromState() {
      const panel = document.getElementById("n404-panel");
      const body = document.getElementById("n404-body");

      if (panel) {
        panel.style.left = currentState.panelX + 'px';
        panel.style.top = currentState.panelY + 'px';
      }

      if (body) {
        body.style.display = currentState.collapsed ? "none" : 'block';
      }

      const btnMute = document.getElementById("btn-mute");
      if (btnMute) {
        btnMute.textContent = currentState.muteActive ? "UNMUTE" : "MUTE";
        btnMute.classList.toggle("active", currentState.muteActive);
      }

      const btnTurbo = document.getElementById("btn-turbo");
      if (btnTurbo) {
        btnTurbo.textContent = currentState.turboActive ? "MAX BOOST (ON)" : "MAX BOOST (OFF)";
        btnTurbo.classList.toggle("active", currentState.turboActive);
      }

      document.getElementById("btn-lock")?.classList.toggle("active", currentState.panelLocked);

      ["clearGain", "masterGain", "rageBoost", "bitrate", "stereoWidth", "eq1", "eq2", "eq3", "eq4", "eq5", "eq6"].forEach(key => {
        const input = document.querySelector(`#n404-panel input[data-param="${key}"]`);
        if (input) {
          input.value = String(currentState[key]);
        }
        this.updateValueLabel(key);
      });
    },

    build() {
      const panel = document.createElement("aside");
      panel.id = "n404-panel";
      panel.innerHTML = `
        <canvas id="n404-bg-canvas"></canvas>
        <div class="n404-header" id="n404-header">
            <span class="n404-title">EAR | PIERCING HOOK</span>
            <div class="n404-hdr-btns">
                <button id="btn-lock" class="n404-icon-btn">📌</button>
                <button id="btn-collapse" class="n404-icon-btn">⚙️</button>
            </div>
        </div>

        <div id="n404-body">
            <div class="n404-visual">
                <canvas id="n404-canvas"></canvas>
            </div>

            <div class="n404-bar">
                <span class="n404-dot"></span>
                <span id="n404-status">INITIALIZING</span>
            </div>

            <div class="n404-palette-box">
                <div class="n404-lbl">CUSTOM COLOR PALETTE</div>
                <div class="n404-palette-container">
                    <canvas id="n404-palette-canvas"></canvas>
                    <div id="n404-color-dot"></div>
                </div>
            </div>

            <div class="n404-sliders">
                <div class="n404-field">
                    <div class="n404-lbl">TALK GAIN <span id="lbl-clearGain">200x</span></div>
                    <input data-param="clearGain" type="range" min="1" max="500" step="1" value="200">
                </div>

                <div class="n404-field">
                    <div class="n404-lbl">EXTREME MASTER <span id="lbl-masterGain">1000x</span></div>
                    <input data-param="masterGain" type="range" min="1" max="100000" step="500" value="1000">
                </div>

                <div class="n404-field">
                    <div class="n404-lbl">RAGE BOOST <span id="lbl-rageBoost">0%</span></div>
                    <input data-param="rageBoost" type="range" min="0" max="100000" step="500" value="0">
                </div>

                <div class="n404-field">
                    <div class="n404-lbl">BITRATE (LO-FI) <span id="lbl-bitrate">2500</span></div>
                    <input data-param="bitrate" type="range" min="1" max="2500" step="1" value="2500">
                </div>

                <div class="n404-field">
                    <div class="n404-lbl">STEREO WIDTH <span id="lbl-stereoWidth">1.0x</span></div>
                    <input data-param="stereoWidth" type="range" min="0" max="2" step="0.05" value="1.0">
                </div>

                <div class="n404-eq-grid">
                    <div class="n404-field"><div class="n404-lbl">100Hz <span id="lbl-eq1">+0.0dB</span></div><input data-param="eq1" type="range" min="-24" max="24" step="0.5" value="0"></div>
                    <div class="n404-field"><div class="n404-lbl">250Hz <span id="lbl-eq2">+0.0dB</span></div><input data-param="eq2" type="range" min="-24" max="24" step="0.5" value="0"></div>
                    <div class="n404-field"><div class="n404-lbl">1kHz <span id="lbl-eq3">+0.0dB</span></div><input data-param="eq3" type="range" min="-24" max="24" step="0.5" value="0"></div>
                    <div class="n404-field"><div class="n404-lbl">3kHz <span id="lbl-eq4">+0.0dB</span></div><input data-param="eq4" type="range" min="-24" max="24" step="0.5" value="0"></div>
                    <div class="n404-field"><div class="n404-lbl">6kHz <span id="lbl-eq5">+0.0dB</span></div><input data-param="eq5" type="range" min="-24" max="24" step="0.5" value="0"></div>
                    <div class="n404-field"><div class="n404-lbl">12kHz <span id="lbl-eq6">+0.0dB</span></div><input data-param="eq6" type="range" min="-24" max="24" step="0.5" value="0"></div>
                </div>
            </div>

            <div class="n404-actions">
                <button id="btn-turbo" class="n404-btn turbo">MAX BOOST (OFF)</button>
                <button id="btn-mute" class="n404-btn">MUTE</button>
                <button id="btn-reset" class="n404-btn reset">RESET</button>
            </div>
        </div>
      `;
      document.body.appendChild(panel);
    },

    bind() {
      const btnCollapse = document.getElementById("btn-collapse");
      const btnLock = document.getElementById("btn-lock");
      const panelBody = document.getElementById("n404-body");
      const btnTurbo = document.getElementById("btn-turbo");
      const btnMute = document.getElementById("btn-mute");
      const btnReset = document.getElementById("btn-reset");

      btnCollapse.addEventListener("click", () => {
        currentState.collapsed = !currentState.collapsed;
        panelBody.style.display = currentState.collapsed ? "none" : 'block';
        saveStateToLocalStorage();
      });

      btnLock.addEventListener("click", () => {
        currentState.panelLocked = !currentState.panelLocked;
        btnLock.classList.toggle("active", currentState.panelLocked);
        saveStateToLocalStorage();
      });

      btnTurbo.addEventListener("click", () => {
        currentState.turboActive = !currentState.turboActive;
        btnTurbo.textContent = currentState.turboActive ? "MAX BOOST (ON)" : "MAX BOOST (OFF)";
        btnTurbo.classList.toggle("active", currentState.turboActive);
        saveStateToLocalStorage();
        AudioInterceptor.pushParamsFast();
      });

      btnMute.addEventListener("click", () => {
        currentState.muteActive = !currentState.muteActive;
        btnMute.textContent = currentState.muteActive ? "UNMUTE" : "MUTE";
        btnMute.classList.toggle("active", currentState.muteActive);
        saveStateToLocalStorage();
        AudioInterceptor.pushParamsFast();
      });

      btnReset.addEventListener("click", () => {
        this.resetToDefaults();
      });

      document.querySelectorAll('#n404-panel input[type="range"]').forEach(input => {
        const preventScroll = (e) => e.stopPropagation();
        input.addEventListener("touchstart", preventScroll, { passive: true });
        input.addEventListener("touchmove", preventScroll, { passive: true });

        const updateVal = (e) => {
          const param = e.target.dataset.param;
          currentState[param] = parseFloat(e.target.value);

          this.updateValueLabel(param);
          AudioInterceptor.schedulePushParams();
          debouncedSaveState();
        };

        input.addEventListener("input", updateVal);
        input.addEventListener("change", updateVal);
      });
    },

    enableDrag() {
      const panel = document.getElementById("n404-panel");
      const header = document.getElementById("n404-header");

      let isDragging = false;
      let startX = 0, startY = 0;
      let initialLeft = 0, initialTop = 0;

      const onStart = (clientX, clientY, target) => {
        if (currentState.panelLocked) return;
        if (target.closest(".n404-hdr-btns") || target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;

        isDragging = true;
        startX = clientX;
        startY = clientY;
        initialLeft = panel.offsetLeft;
        initialTop = panel.offsetTop;
      };

      const onMove = (clientX, clientY, e) => {
        if (!isDragging) return;
        if (e && e.cancelable) e.preventDefault();

        const dx = clientX - startX;
        const dy = clientY - startY;

        const maxX = window.innerWidth - panel.offsetWidth;
        const maxY = window.innerHeight - panel.offsetHeight;

        const nextX = Math.min(Math.max(0, initialLeft + dx), maxX);
        const nextY = Math.min(Math.max(0, initialTop + dy), maxY);

        panel.style.left = nextX + 'px';
        panel.style.top = nextY + 'px';

        currentState.panelX = nextX;
        currentState.panelY = nextY;
      };

      const onEnd = () => {
        if (isDragging) {
          isDragging = false;
          saveStateToLocalStorage();
        }
      };

      header.addEventListener("mousedown", e => onStart(e.clientX, e.clientY, e.target));
      window.addEventListener("mousemove", e => onMove(e.clientX, e.clientY, e));
      window.addEventListener("mouseup", onEnd);

      header.addEventListener("touchstart", e => {
        if (e.touches.length === 1) {
          onStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
        }
      }, { passive: false });

      window.addEventListener("touchmove", e => {
        if (isDragging && e.touches.length === 1) {
          onMove(e.touches[0].clientX, e.touches[0].clientY, e);
        }
      }, { passive: false });

      window.addEventListener("touchend", onEnd);
    },

    injectStyles() {
      const style = document.createElement("style");
      style.textContent = `
        #n404-panel {
          --accent: #ff0000;
          --border: #ff0000;
          position: fixed;
          top: 20px;
          left: 20px;
          width: 310px;
          background: rgba(12, 12, 16, 0.94);
          border: 1px solid var(--border);
          box-shadow: 0 0 20px rgba(0,0,0,0.8), 0 0 10px var(--accent);
          border-radius: 8px;
          color: #fff;
          z-index: 9999999;
          font-family: 'Segoe UI', system-ui, sans-serif;
          user-select: none;
          padding: 12px;
          backdrop-filter: blur(8px);
          overflow: hidden;
          touch-action: none;
        }

        #n404-bg-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 0;
        }

        .n404-header, #n404-body {
          position: relative;
          z-index: 1;
        }

        .n404-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border);
          padding-bottom: 6px;
          cursor: move;
          touch-action: none;
        }

        .n404-title {
          font-size: 13px;
          font-weight: 800;
          color: var(--accent);
          letter-spacing: 1px;
        }

        .n404-icon-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 12px;
          opacity: 0.8;
          color: #fff;
        }

        .n404-icon-btn.active {
          opacity: 1;
          transform: scale(1.2);
        }

        .n404-visual {
          height: 50px;
          background: rgba(0,0,0,0.6);
          border: 1px solid #333;
          margin: 10px 0 6px 0;
          border-radius: 4px;
          overflow: hidden;
          position: relative;
        }

        #n404-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }

        .n404-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          color: var(--accent);
          margin-bottom: 8px;
          font-weight: bold;
        }

        .n404-dot {
          width: 6px;
          height: 6px;
          background: var(--accent);
          border-radius: 50%;
          box-shadow: 0 0 6px var(--accent);
        }

        .n404-palette-box {
          margin-bottom: 10px;
        }

        .n404-palette-container {
          position: relative;
          height: 16px;
          border-radius: 8px;
          overflow: visible;
          margin-top: 4px;
          cursor: pointer;
          touch-action: none;
        }

        #n404-palette-canvas {
          width: 100%;
          height: 100%;
          border-radius: 8px;
          display: block;
        }

        #n404-color-dot {
          position: absolute;
          top: 50%;
          left: 10px;
          transform: translate(-50%, -50%);
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          border: 2px solid #000;
          box-shadow: 0 0 6px #fff;
          pointer-events: none;
        }

        .n404-field {
          margin-bottom: 8px;
        }

        .n404-lbl {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #ccc;
          margin-bottom: 3px;
          font-weight: 600;
        }

        .n404-lbl span {
          color: var(--accent);
        }

        .n404-eq-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px 12px;
          border-top: 1px dashed var(--border);
          padding-top: 8px;
          margin-top: 8px;
        }

        #n404-panel input[type="range"] {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          outline: none;
          cursor: pointer;
          touch-action: none;
        }

        #n404-panel input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent);
          cursor: pointer;
          box-shadow: 0 0 8px var(--accent);
        }

        .n404-actions {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }

        .n404-btn {
          flex: 1;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--accent);
          font-weight: bold;
          font-size: 11px;
          padding: 6px 0;
          border-radius: 4px;
          cursor: pointer;
          transition: 0.2s;
        }

        .n404-btn.active, .n404-btn:hover {
          background: var(--accent);
          color: #000;
          box-shadow: 0 0 10px var(--accent);
        }
      `;
      document.head.appendChild(style);
    }
  };

  if (document.body) {
    UIController.init();
  } else {
    document.addEventListener("DOMContentLoaded", () => UIController.init());
  }
})();
