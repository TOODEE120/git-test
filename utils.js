// ─── SmoothBuffer ─────────────────────────────────────────────────────────────
// Sliding window majority vote with exponential weighting for temporal smoothing
export class SmoothBuffer {
  constructor(size = 12) {
    this.size = size;
    this.buffer = [];
  }

  push(value) {
    this.buffer.push(value);
    if (this.buffer.length > this.size) this.buffer.shift();
  }

  getMajority() {
    if (this.buffer.length === 0) return null;
    
    // Weighted majority voting - recent frames have more weight
    const counts = {};
    const weights = {};
    
    for (let i = 0; i < this.buffer.length; i++) {
      const v = this.buffer[i];
      const weight = Math.pow(0.95, this.buffer.length - 1 - i); // Exponential decay
      counts[v] = (counts[v] || 0) + 1;
      weights[v] = (weights[v] || 0) + weight;
    }
    
    // Return value with highest weighted count
    let maxWeight = -1;
    let result = null;
    for (const [key, weight] of Object.entries(weights)) {
      if (weight > maxWeight) {
        maxWeight = weight;
        result = key;
      }
    }
    return result;
  }

  get length() {
    return this.buffer.length;
  }

  clear() {
    this.buffer = [];
  }
}

// ─── AlertBuffer ──────────────────────────────────────────────────────────────
// Consecutive frame counter + cooldown to reduce false alarms
export class AlertBuffer {
  constructor(threshold = 18, cooldownMs = 4000) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.consecutive = 0;
    this.lastAlertTime = 0;
  }

  update(detected) {
    if (detected) {
      this.consecutive++;
    } else {
      this.consecutive = 0;
    }
  }

  shouldAlert() {
    if (this.consecutive < this.threshold) return false;
    const now = Date.now();
    if (now - this.lastAlertTime < this.cooldownMs) return false;
    this.lastAlertTime = now;
    return true;
  }

  reset() {
    this.consecutive = 0;
  }
}

// ─── formatDuration ───────────────────────────────────────────────────────────
export function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── exportCSV ────────────────────────────────────────────────────────────────
export function exportCSV(logs) {
  const header = 'timestamp,type,severity,message';
  const rows = logs.map(l =>
    `"${l.timestamp}","${l.type}","${l.severity}","${l.message.replace(/"/g, '""')}"`
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `proctor_log_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── playAlertSound ───────────────────────────────────────────────────────────
export function playAlertSound(severity = 'warning') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (severity === 'danger') {
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
      oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.2);
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.4);
    } else {
      oscillator.frequency.setValueAtTime(660, ctx.currentTime);
      oscillator.frequency.setValueAtTime(550, ctx.currentTime + 0.15);
      gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {
    // audio not available
  }
}
