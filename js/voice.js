/* ============================================================
   voice.js — 语音交互模块
   Web Speech API: 语音输入 (SpeechRecognition) + 语音输出 (TTS)
   ============================================================ */

// ── 语音识别 ──
let recognition = null;
let isListening = false;

function initSpeechRecognition() {
  if (recognition) return true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[Voice] 浏览器不支持 SpeechRecognition API');
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;   // 单次识别
  recognition.interimResults = true; // 显示临时结果
  recognition.maxAlternatives = 1;

  return true;
}

/**
 * 开始语音输入
 * @param {Function} onResult - 回调 (finalText, isFinal)
 * @param {Function} onError - 回调 (errorMessage)
 * @param {Function} onStateChange - 回调 (isListening)
 */
function startVoiceInput({ onResult, onError, onStateChange } = {}) {
  if (!initSpeechRecognition()) {
    if (onError) onError('浏览器不支持语音识别。请使用 Chrome 或 Edge 浏览器。');
    return;
  }

  if (isListening) {
    stopVoiceInput();
    return;
  }

  // 设置回调
  recognition.onresult = (event) => {
    let interim = '';
    let final = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += transcript;
      } else {
        interim += transcript;
      }
    }

    if (onResult) {
      onResult(final || interim, !!final);
    }

    if (final) {
      isListening = false;
      if (onStateChange) onStateChange(false);
    }
  };

  recognition.onerror = (event) => {
    console.error('[Voice] 识别错误:', event.error);
    isListening = false;
    if (onStateChange) onStateChange(false);

    const errorMessages = {
      'no-speech': '未检测到语音，请再试一次。',
      'audio-capture': '无法访问麦克风，请检查权限设置。',
      'not-allowed': '麦克风权限被拒绝，请在浏览器设置中允许。',
      'network': '网络连接失败，请检查网络。',
      'aborted': '语音输入已取消。',
      'language-not-supported': '不支持中文语音识别。',
    };

    if (onError) onError(errorMessages[event.error] || `识别错误: ${event.error}`);
  };

  recognition.onend = () => {
    isListening = false;
    if (onStateChange) onStateChange(false);
  };

  try {
    recognition.start();
    isListening = true;
    if (onStateChange) onStateChange(true);
    console.log('[Voice] 开始语音输入...');
  } catch (e) {
    console.error('[Voice] 启动失败:', e);
    isListening = false;
    if (onError) onError('语音启动失败，请重试。');
  }
}

function stopVoiceInput() {
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) { /* ignore */ }
  }
  isListening = false;
}

// ── TTS 语音播报 ──
let ttsUtterance = null;

/**
 * 使用 TTS 朗读文本
 * @param {string} text - 要朗读的文本
 * @param {Object} opts - { rate, pitch, voice, onStart, onEnd }
 */
function speakResult(text, opts = {}) {
  if (!window.speechSynthesis) {
    console.warn('[Voice] 浏览器不支持 SpeechSynthesis API');
    return false;
  }

  // 取消当前正在播报的内容
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = opts.rate || 0.9;   // 稍慢，适合解读
  utterance.pitch = opts.pitch || 1.0;
  utterance.volume = 1.0;

  // 尝试选择中文语音
  if (!opts.voice) {
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find(v =>
      v.lang.startsWith('zh-CN') || v.lang.startsWith('zh-TW') || v.lang.startsWith('zh')
    );
    if (zhVoice) utterance.voice = zhVoice;
  } else {
    utterance.voice = opts.voice;
  }

  utterance.onstart = () => {
    ttsUtterance = utterance;
    if (opts.onStart) opts.onStart();
  };

  utterance.onend = () => {
    ttsUtterance = null;
    if (opts.onEnd) opts.onEnd();
  };

  utterance.onerror = (e) => {
    console.error('[Voice] TTS 错误:', e);
    ttsUtterance = null;
    if (opts.onEnd) opts.onEnd();
  };

  window.speechSynthesis.speak(utterance);
  return true;
}

function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  ttsUtterance = null;
}

function isSpeaking() {
  return window.speechSynthesis && window.speechSynthesis.speaking;
}

// ── 能力检测 ──
function getVoiceCapabilities() {
  return {
    speechRecognition: !!(
      window.SpeechRecognition || window.webkitSpeechRecognition
    ),
    speechSynthesis: !!window.speechSynthesis,
    isListening,
    isSpeaking: isSpeaking(),
    preferredVoice: (() => {
      if (!window.speechSynthesis) return null;
      const voices = window.speechSynthesis.getVoices();
      const zh = voices.find(v => v.lang.startsWith('zh-CN'));
      return zh ? zh.name : null;
    })(),
  };
}

// 确保 voice 列表异步加载
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices(); // 触发加载
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {
      console.log('[Voice] TTS 语音列表已加载:', window.speechSynthesis.getVoices().length, '个');
    };
  }
}

console.log('[Voice] 语音模块已加载 · 能力:', getVoiceCapabilities());
