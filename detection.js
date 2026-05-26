// ─── Gaze Direction ───────────────────────────────────────────────────────────
// Returns: 'center' | 'left' | 'right' | 'up' | 'down'
export function getGazeDirection(landmarks) {
  if (!landmarks || landmarks.length < 478) return 'center';

  // Left eye landmarks (outer=33, inner=133, top=159, bottom=145)
  // Right eye landmarks (outer=362, inner=263, top=386, bottom=374)
  // Iris: left center=468, right center=473
  const leftIris = landmarks[468];
  const rightIris = landmarks[473];
  const leftOuter = landmarks[33];
  const leftInner = landmarks[133];
  const leftTop = landmarks[159];
  const leftBottom = landmarks[145];
  const rightOuter = landmarks[362];
  const rightInner = landmarks[263];
  const rightTop = landmarks[386];
  const rightBottom = landmarks[374];

  if (!leftIris || !rightIris) return 'center';

  const getEyeRatio = (iris, outer, inner, top, bottom) => {
    const minX = Math.min(outer.x, inner.x), maxX = Math.max(outer.x, inner.x);
    const minY = Math.min(top.y, bottom.y), maxY = Math.max(top.y, bottom.y);
    const w = maxX - minX, h = maxY - minY;
    return {
      hRatio: w > 0 ? (iris.x - minX) / w : 0.5,
      vRatio: h > 0 ? (iris.y - minY) / h : 0.5,
      ear: w > 0 ? h / w : 0 // Eye Aspect Ratio (สัดส่วนการลืมตา)
    };
  };

  const lEye = getEyeRatio(leftIris, leftOuter, leftInner, leftTop, leftBottom);
  const rEye = getEyeRatio(rightIris, rightOuter, rightInner, rightTop, rightBottom);

  // Filter out eye blinks: if eyelid gap is too narrow (closing eyes), skip processing
  const avgEAR = (lEye.ear + rEye.ear) / 2;
  if (avgEAR < 0.12 || isNaN(avgEAR)) return 'center';
  if (avgEAR > 0.5) return 'center'; // Eyes too open (glitches)

  let avgHRatio = (lEye.hRatio + rEye.hRatio) / 2;
  let avgVRatio = (lEye.vRatio + rEye.vRatio) / 2;

  // ระบบชดเชยการหันหน้า (Head Pose Compensation)
  const noseTip = landmarks[1], leftFace = landmarks[127], rightFace = landmarks[356], forehead = landmarks[10], chin = landmarks[152];
  if (noseTip && leftFace && rightFace && forehead && chin) {
    const faceWidth = Math.abs(rightFace.x - leftFace.x);
    const faceHeight = Math.abs(chin.y - forehead.y);
    if (faceWidth > 0 && faceHeight > 0) {
      const faceCenterX = (leftFace.x + rightFace.x) / 2;
      const faceCenterY = (forehead.y + chin.y) / 2;
      const yaw = (noseTip.x - faceCenterX) / faceWidth;
      const pitch = (noseTip.y - faceCenterY) / faceHeight;
      
      // Apply head pose compensation with enhanced 3D calibration
      const clampedYaw = Math.max(-0.3, Math.min(0.3, yaw));
      const clampedPitch = Math.max(-0.3, Math.min(0.3, pitch));
      avgHRatio += (clampedYaw * 0.65);
      avgVRatio += (clampedPitch * 0.65);
    }
  }

  // Adjusted thresholds for better sensitivity with hysteresis
  if (avgHRatio < 0.32) return 'left';
  if (avgHRatio > 0.68) return 'right';
  if (avgVRatio < 0.28) return 'up';
  if (avgVRatio > 0.72) return 'down';
  return 'center';
}

// ─── Head Pose ────────────────────────────────────────────────────────────────
// Returns: 'center' | 'left' | 'right' | 'up' | 'down'
export function getHeadDirection(landmarks) {
  if (!landmarks || landmarks.length < 468) return 'center';

  const noseTip = landmarks[1];
  const leftFace = landmarks[127];
  const rightFace = landmarks[356];
  const forehead = landmarks[10];
  const chin = landmarks[152];

  if (!noseTip || !leftFace || !rightFace || !forehead || !chin) return 'center';

  const faceWidth = Math.abs(rightFace.x - leftFace.x);
  const faceHeight = Math.abs(chin.y - forehead.y);
  if (faceWidth < 0.001 || faceHeight < 0.001) return 'center';

  const faceCenterX = (leftFace.x + rightFace.x) / 2;
  const faceCenterY = (forehead.y + chin.y) / 2;

  let yawRatio = (noseTip.x - faceCenterX) / faceWidth;
  let pitchRatio = (noseTip.y - faceCenterY) / faceHeight;
  
  // Clamp to realistic ranges to prevent glitches
  yawRatio = Math.max(-0.5, Math.min(0.5, yawRatio));
  pitchRatio = Math.max(-0.4, Math.min(0.4, pitchRatio));

  if (yawRatio > 0.13) return 'right';
  if (yawRatio < -0.13) return 'left';
  if (pitchRatio < -0.12) return 'up';
  if (pitchRatio > 0.17) return 'down';
  return 'center';
}

// ─── Canvas Overlay ───────────────────────────────────────────────────────────
export function drawOverlays(canvas, video, landmarks, headDir, suspiciousObjects, extraFaces) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  const toCanvas = (lm) => ({ x: lm.x * w, y: lm.y * h });

  // ── Sci-Fi Scanning Laser Effect ──
  const time = Date.now() / 1500;
  const scanY = ((Math.sin(time * 3) + 1) / 2) * h;
  ctx.shadowBlur = 10;
  ctx.shadowColor = 'rgba(0, 255, 136, 0.8)';
  ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, scanY);
  ctx.lineTo(w, scanY);
  ctx.stroke();
  ctx.fillStyle = 'rgba(0, 255, 136, 0.05)';
  ctx.fillRect(0, scanY - 30, w, 60);
  ctx.shadowBlur = 0; // Reset

  if (landmarks && landmarks.length >= 478) {
    // ── Draw Full Face Mesh ──
    if (window.FACEMESH_TESSELATION) {
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.15)'; // สีเขียวจางๆ
      ctx.lineWidth = 0.5; // ขนาดเส้น
      ctx.beginPath();
      window.FACEMESH_TESSELATION.forEach(([start, end]) => {
        const p1 = toCanvas(landmarks[start]);
        const p2 = toCanvas(landmarks[end]);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      });
      ctx.stroke();
    } else {
      // Fallback: หากไม่พบข้อมูล Tesselation จะวาดเป็นจุด 478 จุดแทน
      ctx.fillStyle = 'rgba(0, 255, 136, 0.3)';
      landmarks.forEach(lm => {
        const p = toCanvas(lm);
        ctx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
      });
    }

    // ── Draw iris points with glow ──
    const leftIris = landmarks[468];
    const rightIris = landmarks[473];

    if (leftIris && rightIris) {
      [leftIris, rightIris].forEach(iris => {
        const p = toCanvas(iris);
        // Outer glow
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 10);
        grad.addColorStop(0, 'rgba(0, 255, 136, 0.9)');
        grad.addColorStop(0.5, 'rgba(0, 255, 136, 0.3)');
        grad.addColorStop(1, 'rgba(0, 255, 136, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.fillStyle = '#00ff88';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // ── Target Crosshair on Face Center ──
    const noseTip = landmarks[1];
    if (noseTip) {
      const nP = toCanvas(noseTip);
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(nP.x - 15, nP.y - 15, 30, 30);
      ctx.beginPath(); ctx.moveTo(nP.x - 20, nP.y); ctx.lineTo(nP.x + 20, nP.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(nP.x, nP.y - 20); ctx.lineTo(nP.x, nP.y + 20); ctx.stroke();
    }

    // ── Draw nose-to-chin line (head pose indicator) ──
    const chin = landmarks[152];
    if (noseTip && chin) {
      const noseP = toCanvas(noseTip);
      const chinP = toCanvas(chin);
      const isAligned = headDir === 'center';

      ctx.strokeStyle = isAligned ? 'rgba(0, 255, 136, 0.8)' : 'rgba(255, 60, 60, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(noseP.x, noseP.y);
      ctx.lineTo(chinP.x, chinP.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Direction arrow
      if (!isAligned) {
        ctx.fillStyle = 'rgba(255, 60, 60, 0.9)';
        ctx.font = `bold ${Math.round(w * 0.04)}px IBM Plex Mono`;
        ctx.textAlign = 'center';
        const arrowMap = { left: '◀', right: '▶', up: '▲', down: '▼' };
        const midX = (noseP.x + chinP.x) / 2;
        const midY = (noseP.y + chinP.y) / 2;
        ctx.fillText(arrowMap[headDir] || '', midX, midY);
      }
    }
  } else {
    // No main face — draw scan lines
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.15)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  // ── Draw suspicious object bounding boxes ──
  if (suspiciousObjects && suspiciousObjects.length > 0) {
    const labelMap = {
      'cell phone': 'โทรศัพท์',
      'book': 'หนังสือ',
      'laptop': 'แล็ปท็อป',
      'remote': 'รีโมต',
      'tablet': 'แท็บเล็ต',
    };

    suspiciousObjects.forEach(obj => {
      const [x, y, bw, bh] = obj.bbox;
      ctx.strokeStyle = 'rgba(255, 50, 50, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, bw, bh);

      // Corners
      const cs = 12;
      ctx.strokeStyle = '#ff3232';
      ctx.lineWidth = 3;
      [[x, y], [x + bw, y], [x, y + bh], [x + bw, y + bh]].forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.moveTo(cx - cs * Math.sign(bw / 2 - (cx - x)), cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy - cs * Math.sign(bh / 2 - (cy - y)));
        ctx.stroke();
      });

      // Label badge
      const label = labelMap[obj.class] || obj.class;
      const pct = Math.round(obj.score * 100);
      const text = `${label} ${pct}%`;
      ctx.font = `bold ${Math.round(w * 0.025)}px IBM Plex Mono`;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(255, 30, 30, 0.85)';
      ctx.fillRect(x, y - 24, tw + 12, 22);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 6, y - 7);
    });
  }

  // ── Draw Multiple Faces Bounding Boxes ──
  if (extraFaces && extraFaces.length > 1) {
    extraFaces.forEach((face, idx) => {
      const bbox = face.boundingBox;
      if (!bbox) return;

      const xMin = bbox.xMin !== undefined ? bbox.xMin : bbox.xCenter - bbox.width / 2;
      const yMin = bbox.yMin !== undefined ? bbox.yMin : bbox.yCenter - bbox.height / 2;
      const bx = xMin * w;
      const by = yMin * h;
      const bw = bbox.width * w;
      const bh = bbox.height * h;

      ctx.strokeStyle = 'rgba(255, 100, 0, 0.9)'; // ส้มแดงเตือนภัย
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]); // วาดกรอบประ
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255, 100, 0, 0.9)';
      ctx.font = `bold ${Math.round(w * 0.022)}px IBM Plex Mono`;
      const text = `ใบหน้าที่ ${idx + 1}`;
      const tw = ctx.measureText(text).width;
      ctx.fillRect(bx, by - 22, tw + 10, 20);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(text, bx + 5, by - 7);
    });
  }
}
