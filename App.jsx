import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs';
import './App.css';
import { getGazeDirection, getHeadDirection, drawOverlays } from './detection.js';
import { AlertBuffer, SmoothBuffer, formatDuration, exportCSV, playAlertSound } from './utils.js';

const SUSPICIOUS_CLASSES = new Set(['cell phone', 'book', 'laptop', 'remote', 'tablet', 'keyboard', 'mouse']);
const GAZE_THRESHOLD = 6;  // โหมดสูงกว่าเดิมเพื่อความแม่นยำ
const HEAD_THRESHOLD = 6;
const NOFACE_THRESHOLD = 10;  // เพิ่มการตอบสนอง
const FRAME_SKIP_FACE_DETECTION = 2;  // ลดการประมวลผล face detection มากขึ้น
const FRAME_SKIP_OBJECT_DETECTION = 4;  // ลดการประมวลผล object detection
const ADAPTIVE_THRESHOLD = 0.3;  // Adaptive threshold สำหรับตรวจจับผิดปกติ

function getOverallStatus(alerts) {
  const recent = alerts.slice(0, 5);
  if (recent.some(a => a.severity === 'danger')) return 'danger';
  if (recent.some(a => a.severity === 'warn')) return 'warning';
  return 'normal';
}

function gazeLabel(dir) {
  const map = { center: 'ตรงหน้า', left: 'ซ้าย', right: 'ขวา', up: 'บน', down: 'ล่าง' };
  return map[dir] || dir;
}
function headLabel(dir) {
  const map = { center: 'ตรงหน้า', left: 'ซ้าย', right: 'ขวา', up: 'แหงน', down: 'ก้ม' };
  return map[dir] || dir;
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const faceMeshRef = useRef(null);
  const faceDetectionRef = useRef(null);
  const cocoRef = useRef(null);
  const frameCountRef = useRef(0);
  const startTimeRef = useRef(null);
  const isRunningRef = useRef(false);
  const faceMeshBusyRef = useRef(false);
  const faceDetectBusyRef = useRef(false);
  const cocoBusyRef = useRef(false);

  const faceCountRef = useRef(0);
  const suspiciousObjRef = useRef([]);
  const extraFacesRef = useRef([]);
  const gazeSmoothRef = useRef(new SmoothBuffer(10));
  const headSmoothRef = useRef(new SmoothBuffer(6));

  const gazeAlertRef = useRef(new AlertBuffer(GAZE_THRESHOLD, 4000));
  const headAlertRef = useRef(new AlertBuffer(HEAD_THRESHOLD, 4000));
  const noFaceAlertRef = useRef(new AlertBuffer(NOFACE_THRESHOLD, 4000));
  const multiFaceAlertRef = useRef(new AlertBuffer(5, 5000));
  const objAlertRef = useRef(new AlertBuffer(1, 6000));
  const alertsInternalRef = useRef([]);

  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [gazeDir, setGazeDir] = useState('center');
  const [headDir, setHeadDir] = useState('center');
  const [faceCount, setFaceCount] = useState(0);
  const [suspObjects, setSuspObjects] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [dangerCount, setDangerCount] = useState(0);
  const [frameDisplay, setFrameDisplay] = useState(0);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [dangerFlash, setDangerFlash] = useState(false);

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
      setFrameDisplay(frameCountRef.current);
    }, 500);
    return () => clearInterval(id);
  }, [isRunning]);

  const addAlert = useCallback((message, type, severity) => {
    let image = null;
    // บันทึกภาพเฉพาะตอนที่แจ้งเตือนระดับ "เฝ้าระวัง" (warn) หรือ "อันตราย" (danger)
    if (severity === 'danger' || severity === 'warn') {
      const video = videoRef.current;
      if (video && video.videoWidth > 0) {
        try {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = video.videoWidth;
          tempCanvas.height = video.videoHeight;
          const ctx = tempCanvas.getContext('2d');
          if (!ctx) throw new Error('Canvas context unavailable');
          
          ctx.save();
          ctx.translate(tempCanvas.width, 0);
          ctx.scale(-1, 1); // กลับซ้าย-ขวาภาพให้เหมือนที่เห็นบนหน้าจอเว็บ
          ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height); // วาดภาพคน
          ctx.restore();
          
          // ─── วาดลายน้ำ วันที่และเวลา ───
          const now = new Date();
          const timestampText = `${now.toLocaleDateString('th-TH')} ${now.toLocaleTimeString('th-TH')}`;
          const watermarkText = `PROCTOR.sys | ${timestampText}`;
          
          ctx.font = '18px "IBM Plex Mono", sans-serif';
          const textWidth = ctx.measureText(watermarkText).width;
          
          // วาดพื้นหลังสีดำโปร่งแสง
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(tempCanvas.width - textWidth - 20, tempCanvas.height - 40, textWidth + 20, 40);
          
          // วาดตัวหนังสือสีขาว
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'right';
          ctx.fillText(watermarkText, tempCanvas.width - 10, tempCanvas.height - 15);

          image = tempCanvas.toDataURL('image/jpeg', 0.6); // บันทึกและบีบอัดเป็น JPEG 60%
        } catch (err) {
          console.error('Error capturing screenshot:', err);
        }
      }
    }

    const entry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toLocaleTimeString('th-TH'),
      message, type, severity, image
    };
    alertsInternalRef.current = [entry, ...alertsInternalRef.current].slice(0, 200);
    setAlerts([...alertsInternalRef.current]);
    setTotalAlerts(c => c + 1);
    if (severity === 'danger') {
      setDangerCount(c => c + 1);
      playAlertSound('danger');
      setDangerFlash(true);
      setTimeout(() => setDangerFlash(false), 800); // กระพริบหน้าจอแดง 0.8 วินาที
    } else if (severity === 'warn') {
      playAlertSound('warning');
    }
  }, []);

  const runLoop = useCallback(() => {
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth || !video.videoHeight || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(runLoop);
        return;
      }
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        setVideoSize({ w: video.videoWidth, h: video.videoHeight });
      }
      frameCountRef.current++;
      const fc = frameCountRef.current;

      // Face Mesh: รันทุกเฟรมเพื่อให้ราบรื่น
      if (faceMeshRef.current && !faceMeshBusyRef.current && typeof faceMeshRef.current.send === 'function') {
        faceMeshBusyRef.current = true;
        faceMeshRef.current.send({ image: video })
          .catch(err => console.debug('FaceMesh error:', err?.message || 'Unknown error'))
          .finally(() => { faceMeshBusyRef.current = false; });
      }
      
      // Face Detection: ลดความถี่
      if (fc % FRAME_SKIP_FACE_DETECTION === 0 && faceDetectionRef.current && !faceDetectBusyRef.current && typeof faceDetectionRef.current.send === 'function') {
        faceDetectBusyRef.current = true;
        faceDetectionRef.current.send({ image: video })
          .catch(err => console.debug('FaceDetection error:', err?.message || 'Unknown error'))
          .finally(() => { faceDetectBusyRef.current = false; });
      }
      
      // Object Detection: ลดความถี่ + ปรับ confidence
      if (fc % FRAME_SKIP_OBJECT_DETECTION === 0 && cocoRef.current && !cocoBusyRef.current && typeof cocoRef.current.detect === 'function') {
        cocoBusyRef.current = true;
        cocoRef.current.detect(video)
          .then(preds => {
            if (!Array.isArray(preds)) return;
            const susp = preds.filter(p => SUSPICIOUS_CLASSES.has(p.class) && (p.score >= 0.50));
            suspiciousObjRef.current = susp;
            setSuspObjects(susp);
            objAlertRef.current.update(susp.length > 0);
            if (objAlertRef.current.shouldAlert() && susp.length > 0) {
              const names = susp.map(s => s.class).join(', ');
              addAlert('ตรวจพบวัตถุต้องสงสัย: ' + names, 'object', 'danger');
            }
          })
          .catch(err => console.debug('COCO-SSD error:', err?.message || 'Unknown error'))
          .finally(() => { cocoBusyRef.current = false; });
      }
      rafRef.current = requestAnimationFrame(runLoop);
    } catch (e) {
      console.error('runLoop error:', e);
      rafRef.current = requestAnimationFrame(runLoop);
    }
  }, [addAlert]);

  const initFaceMesh = useCallback(() => {
    return new Promise((resolve, reject) => {
      try {
        if (!window.FaceMesh) { reject(new Error('FaceMesh not loaded')); return; }
        const fm = new window.FaceMesh({
          locateFile: (f) => 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/' + f
        });
        fm.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.4,  // ลดเพื่อจับใบหน้าได้ง่ายขึ้น
          minTrackingConfidence: 0.55,   // ลดเพื่อให้ติดตามต่อเนื่อง
        });
      fm.onResults((results) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const lms = results.multiFaceLandmarks?.[0] || null;

        const rawGaze = lms ? getGazeDirection(lms) : 'center';
        const rawHead = lms ? getHeadDirection(lms) : 'center';
        gazeSmoothRef.current.push(rawGaze);
        headSmoothRef.current.push(rawHead);
        const smoothGaze = gazeSmoothRef.current.getMajority() || 'center';
        const smoothHead = headSmoothRef.current.getMajority() || 'center';
        setGazeDir(smoothGaze);
        setHeadDir(smoothHead);

        noFaceAlertRef.current.update(!lms);
        if (noFaceAlertRef.current.shouldAlert()) {
          addAlert('ไม่พบใบหน้าผู้สอบ — อาจออกจากกล้อง', 'noface', 'danger');
        }
        gazeAlertRef.current.update(smoothGaze !== 'center');
        if (gazeAlertRef.current.shouldAlert()) {
          addAlert('สายตามองทิศ ' + gazeLabel(smoothGaze) + ' ต่อเนื่อง', 'gaze', 'warn');
        }
        headAlertRef.current.update(smoothHead !== 'center');
        if (headAlertRef.current.shouldAlert()) {
          addAlert('หันหน้าไปทาง ' + headLabel(smoothHead) + ' ต่อเนื่อง', 'head', 'warn');
        }
        drawOverlays(canvas, videoRef.current, lms, smoothHead, suspiciousObjRef.current, extraFacesRef.current);
      });
      fm.initialize().then(() => { faceMeshRef.current = fm; resolve(); }).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }, [addAlert]);

  const initFaceDetection = useCallback(() => {
    return new Promise((resolve, reject) => {
      try {
        if (!window.FaceDetection) { reject(new Error('FaceDetection not loaded')); return; }
        const fd = new window.FaceDetection({
          locateFile: (f) => 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/' + f
        });
        fd.setOptions({ model: 'full', minDetectionConfidence: 0.45 });  // ปรับเพื่อจับคนหลายคน
      fd.onResults((results) => {
        const count = results.detections?.length || 0;
        faceCountRef.current = count;
        extraFacesRef.current = results.detections || [];
        setFaceCount(count);
        multiFaceAlertRef.current.update(count > 1);
        if (multiFaceAlertRef.current.shouldAlert()) {
          addAlert('ตรวจพบ ' + count + ' ใบหน้าในกล้อง — อาจมีผู้อื่น', 'multiface', 'danger');
        }
      });
      fd.initialize().then(() => { faceDetectionRef.current = fd; resolve(); }).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }, [addAlert]);

  const startProctoring = useCallback(async () => {
    setIsLoading(true);
    try {
      setLoadingMsg('กำลังเปิดกล้อง...');
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('เบราว์เซอร์ไม่รองรับกล้อง หรือคุณไม่ได้เข้าเว็บผ่าน localhost / HTTPS');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await new Promise(res => { video.onloadedmetadata = res; });
      await video.play();

      setLoadingMsg('กำลังโหลด FaceMesh...');
      await initFaceMesh();

      setLoadingMsg('กำลังโหลด FaceDetection...');
      await initFaceDetection();

      setLoadingMsg('กำลังโหลด COCO-SSD...');
      const model = await cocoSsd.load({ base: 'mobilenet_v2' });
      cocoRef.current = model;

      startTimeRef.current = Date.now();
      frameCountRef.current = 0;
      isRunningRef.current = true;
      setIsRunning(true);
      setIsLoading(false);
      addAlert('เริ่มต้นระบบตรวจสอบ', 'system', 'info');
      rafRef.current = requestAnimationFrame(runLoop);
    } catch (e) {
      setIsLoading(false);
      console.error('Start error:', e);
      
      let errorMsg = e.message;
      if (e.name === 'NotAllowedError' || e.message.includes('Permission denied')) {
        errorMsg = 'คุณยังไม่อนุญาตให้ใช้งานกล้อง กรุณากดอนุญาตที่รูปแม่กุญแจบนแถบ URL';
      } else if (e.name === 'NotFoundError' || e.message.includes('Requested device not found')) {
        errorMsg = 'ไม่พบกล้องเชื่อมต่ออยู่กับอุปกรณ์นี้ หรือกล้องอาจเสีย';
      } else if (e.name === 'NotReadableError' || e.message.includes('hardware error')) {
        errorMsg = 'กล้องถูกใช้งานโดยโปรแกรมอื่น (เช่น Zoom/Teams) กรุณาปิดโปรแกรมเหล่านั้นก่อน';
      }
      addAlert('เกิดข้อผิดพลาด: ' + errorMsg, 'system', 'danger');
    }
  }, [initFaceMesh, initFaceDetection, runLoop, addAlert]);

  const stopProctoring = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (faceMeshRef.current) { try { faceMeshRef.current.close(); } catch(e) {} faceMeshRef.current = null; }
    if (faceDetectionRef.current) { try { faceDetectionRef.current.close(); } catch(e) {} faceDetectionRef.current = null; }
    cocoRef.current = null;
    isRunningRef.current = false;
    setIsRunning(false);
    setGazeDir('center'); setHeadDir('center'); setFaceCount(0); setSuspObjects([]);
    extraFacesRef.current = [];
    addAlert('หยุดการตรวจสอบ', 'system', 'info');
  }, [addAlert]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
  }, []);

  const overallStatus = isRunning ? getOverallStatus(alerts) : 'normal';
  const statusLabel = { normal: 'ปกติ', warning: 'เฝ้าระวัง', danger: 'ต้องสงสัย' };
  const gazeClass = gazeDir === 'center' ? 'ok' : gazeDir === 'up' || gazeDir === 'down' ? 'warn' : 'danger';
  const headClass = headDir === 'center' ? 'ok' : 'warn';
  const faceCountClass = faceCount === 1 ? 'ok' : faceCount === 0 ? (isRunning ? 'danger' : '') : 'danger';
  const objClass = suspObjects.length > 0 ? 'danger' : 'ok';

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">PROCTOR<span>.sys</span></div>
          <div className="header-badge">v2.0 — AI Proctoring</div>
        </div>
        <div className="header-right">
          <div className={`status-dot ${isRunning ? (overallStatus === 'danger' ? 'danger' : 'active') : ''}`} />
          {isRunning && <div className="timer">{formatDuration(elapsed)}</div>}
        </div>
      </header>

      <div className="main">
        <div className="video-panel">
          <div className="video-container">
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} />
            {isRunning && <>
              <div className="corner corner-tl" />
              <div className="corner corner-tr" />
              <div className="corner corner-bl" />
              <div className="corner corner-br" />
            </>}
          <div className={`video-flash ${dangerFlash ? 'active' : ''}`} />
            {isRunning && (
              <div className="hud-overlay">
                <div className={'hud-badge ' + overallStatus}>
                  <span>◉</span>
                  <span>{statusLabel[overallStatus]}</span>
                </div>
              </div>
            )}
            {!isRunning && !isLoading && (
              <div className="no-camera">
                <div className="no-camera-icon">⬡</div>
                <p>ยังไม่ได้เปิดกล้อง</p>
                <button className="btn-start" onClick={startProctoring}>▶ เริ่มตรวจสอบ</button>
              </div>
            )}
            {isLoading && (
              <div className="loading-overlay">
                <div className="loading-bar"><div className="loading-bar-fill" /></div>
                <div className="loading-text">{loadingMsg}</div>
              </div>
            )}
          </div>
          <div className="video-footer">
            <div className="video-res">
              {isRunning ? videoSize.w + 'x' + videoSize.h + ' — frame ' + frameDisplay : 'รอการเชื่อมต่อ'}
            </div>
            {isRunning && <button className="btn-stop" onClick={stopProctoring}>■ หยุด</button>}
          </div>
        </div>

        <div className="right-panel">
          <div className="metrics-grid">
            <div className={'metric-card ' + (faceCountClass === 'danger' && isRunning ? 'alert' : '')}>
              <div className="metric-label">จำนวนใบหน้า</div>
              <div className={'metric-value ' + (isRunning ? faceCountClass : '')}>{isRunning ? faceCount : '—'}</div>
              <div className="metric-sub">{faceCount === 0 && isRunning ? 'ไม่พบผู้สอบ' : faceCount === 1 ? 'ปกติ' : faceCount > 1 ? 'พบ ' + faceCount + ' คน' : 'รอการเชื่อมต่อ'}</div>
            </div>
            <div className={'metric-card ' + (gazeDir !== 'center' && isRunning ? 'alert' : '')}>
              <div className="metric-label">ทิศทางตา</div>
              <div className={'metric-value ' + (isRunning ? gazeClass : '')}>{isRunning ? gazeLabel(gazeDir) : '—'}</div>
              <div className="metric-sub">Iris Tracking</div>
            </div>
            <div className={'metric-card ' + (headDir !== 'center' && isRunning ? 'alert' : '')}>
              <div className="metric-label">ทิศทางหน้า</div>
              <div className={'metric-value ' + (isRunning ? headClass : '')}>{isRunning ? headLabel(headDir) : '—'}</div>
              <div className="metric-sub">Head Pose</div>
            </div>
            <div className={'metric-card ' + (suspObjects.length > 0 ? 'alert' : '')}>
              <div className="metric-label">วัตถุต้องสงสัย</div>
              <div className={'metric-value ' + (isRunning ? objClass : '')}>{isRunning ? suspObjects.length : '—'}</div>
              <div className="metric-sub">{suspObjects.length > 0 ? suspObjects.map(o => o.class).join(', ') : 'ไม่พบ'}</div>
            </div>
          </div>

          <div className="stats-row">
            <div className="stat-cell">
              <div className={'stat-num ' + (totalAlerts > 0 ? 'warn' : '')}>{totalAlerts}</div>
              <div className="stat-label">การแจ้งเตือน</div>
            </div>
            <div className="stat-cell">
              <div className={'stat-num ' + (dangerCount > 0 ? 'danger' : '')}>{dangerCount}</div>
              <div className="stat-label">อันตราย</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num">{alerts.length}</div>
              <div className="stat-label">บันทึกทั้งหมด</div>
            </div>
            <div className="stat-cell">
              <div className="stat-num ok">{isRunning ? formatDuration(elapsed) : '00:00'}</div>
              <div className="stat-label">เวลาสอบ</div>
            </div>
          </div>

          <div className="alert-section">
            <div className="alert-header">
              <div className="alert-title">⚡ บันทึกการแจ้งเตือน</div>
              <button className="btn-export" onClick={() => exportCSV(alerts)}>↓ Export CSV</button>
            </div>
            <div className="alert-list">
              {alerts.length === 0 ? (
                <div className="alert-empty">— ยังไม่มีการแจ้งเตือน —</div>
              ) : alerts.map(a => (
                <div key={a.id} className="alert-item">
                  <div className={'alert-item-dot dot-' + (a.severity === 'info' ? 'info' : a.severity === 'warn' ? 'warn' : 'danger')} />
                  <div className="alert-item-content">
                    <div className={'alert-item-msg ' + (a.severity === 'warn' ? 'warn' : a.severity === 'danger' ? 'danger' : '')}>{a.message}</div>
                    <div className="alert-item-time">{a.timestamp}</div>
                  </div>
                  {a.image && (
                    <a href={a.image} download={`evidence_${a.id}.jpg`} className="alert-evidence-btn" title="โหลดภาพหลักฐาน">
                      📸
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
