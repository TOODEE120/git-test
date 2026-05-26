/**
 * Enterprise Face & Behavior Detection Module
 * Optimized for React & Frame Skipping
 */
export class AdvancedFaceDetector {
    constructor() {
      // Liveness State
      this.lastBlinkTime = Date.now();
      this.lastMouthMoveTime = Date.now();
      this.earHistory = [];
      this.marHistory = [];
      this.SPOOFING_TIMEOUT = 10000; // 10 วินาที
      
      // Lighting Check State (ใช้ Canvas ขนาดจิ๋วเพื่อไม่ให้กิน CPU)
      this.lightCanvas = document.createElement('canvas');
      this.lightCtx = this.lightCanvas.getContext('2d', { willReadFrequently: true });
      this.lightCanvas.width = 32;
      this.lightCanvas.height = 32;

      // Glare Check State (สร้าง Canvas แยกสำหรับตรวจสอบแสงสะท้อนรอบดวงตา)
      this.glareCanvas = document.createElement('canvas');
      this.glareCtx = this.glareCanvas.getContext('2d', { willReadFrequently: true });
      this.glareCanvas.width = 64; // พื้นที่ตาซ้าย 32px + ตาขวา 32px
      this.glareCanvas.height = 16;
  
      // EMA (Exponential Moving Average) สำหรับลบรอยหยัก/สั่นของกล้อง
      this.smoothYaw = 0;
      this.smoothPitch = 0;
      this.smoothRoll = 0;
      this.ALPHA = 0.3; // 0-1 (ยิ่งน้อยยิ่งนิ่ง แต่ตอบสนองช้าลง)
    }
  
    /**
     * ฟังก์ชันหลักสำหรับวิเคราะห์เฟรม
     * @param {Array} landmarks - จุด 468 จุดจาก MediaPipe Face Mesh
     * @param {HTMLVideoElement} videoElement - สำหรับดึงภาพมาเช็คแสง
     * @returns {Object} ผลลัพธ์การประเมิน
     */
    analyze(landmarks, videoElement = null) {
      if (!landmarks || landmarks.length < 468) {
        return { error: 'NO_FACE' };
      }
  
      // 1. Dynamic Head Pose (คำนวณแบบ 3D)
      const headPose = this.calculateHeadPose(landmarks);
  
      // 2. Gaze Detection (ตรวจสอบการชำเลืองตา)
      const gaze = this.calculateGaze(landmarks);
  
      // 3. Liveness Detection (ตรวจสอบคนเป็น ป้องกันรูปถ่าย)
      const liveness = this.checkLiveness(landmarks);
  
      // 4. Lighting & Occlusion (แสงและการบดบัง)
      const environment = this.checkLightingAndOcclusion(landmarks, videoElement);

      // 5. Glass Glare (ตรวจจับแสงสะท้อนบนแว่นตา)
      const hasGlassGlare = this.checkGlassGlare(landmarks, videoElement);
  
      return {
        headPose,
        gaze,
        liveness,
        environment,
        hasGlassGlare,
        isSpoofing: !liveness.isAlive,
        isValid: environment.isLightingGood && !environment.isOccluded && !hasGlassGlare
      };
    }
  
    // ==========================================
    // 1. Dynamic Head Pose (พิจารณาแกน Z)
    // ==========================================
    calculateHeadPose(face) {
      const top = face[10];
      const bottom = face[152];
      const left = face[234];
      const right = face[454];
  
      // สมการหาองศาโดยเปรียบเทียบแกนความลึก (Z) กับแกนกว้าง/ยาว (X, Y)
      // Math.atan2 จะคืนค่าเรเดียน นำมาคูณ (180/PI) เพื่อแปลงเป็นองศา
      const rawYaw = Math.atan2(right.z - left.z, right.x - left.x) * (180 / Math.PI);
      const rawPitch = Math.atan2(bottom.z - top.z, bottom.y - top.y) * (180 / Math.PI);
      const rawRoll = Math.atan2(right.y - left.y, right.x - left.x) * (180 / Math.PI);
  
      // สมูทค่าด้วย EMA (Exponential Moving Average)
      this.smoothYaw = (this.ALPHA * rawYaw) + ((1 - this.ALPHA) * this.smoothYaw);
      this.smoothPitch = (this.ALPHA * rawPitch) + ((1 - this.ALPHA) * this.smoothPitch);
      this.smoothRoll = (this.ALPHA * rawRoll) + ((1 - this.ALPHA) * this.smoothRoll);
  
      let direction = 'CENTER';
      if (this.smoothYaw < -15) direction = 'RIGHT'; // ค่า Z ของแก้มขวาใกล้กล้องมากกว่า
      else if (this.smoothYaw > 15) direction = 'LEFT';
      else if (this.smoothPitch < 65) direction = 'UP';
      else if (this.smoothPitch > 105) direction = 'DOWN';
      else if (Math.abs(this.smoothRoll) > 18) direction = 'TILTED';
  
      return { yaw: this.smoothYaw, pitch: this.smoothPitch, roll: this.smoothRoll, direction };
    }
  
    // ==========================================
    // 2. Liveness Detection (Anti-Spoofing)
    // ==========================================
    checkLiveness(face) {
      const now = Date.now();
  
      // Eye Aspect Ratio (EAR) - คำนวณตาสองข้าง
      const leftEAR = this.getEAR(face, 33, 160, 158, 133, 153, 144);
      const rightEAR = this.getEAR(face, 362, 385, 387, 263, 373, 380);
      const avgEAR = (leftEAR + rightEAR) / 2;
  
      // Mouth Aspect Ratio (MAR)
      const mouthWidth = Math.hypot(face[308].x - face[78].x, face[308].y - face[78].y);
      const mouthHeight = Math.hypot(face[14].x - face[13].x, face[14].y - face[13].y);
      const MAR = mouthWidth > 0 ? mouthHeight / mouthWidth : 0;
  
      // เช็คกะพริบตา (EAR ตกชั่วขณะ)
      if (avgEAR < 0.18) this.lastBlinkTime = now;
      // เช็คขยับปาก (MAR มีการเปลี่ยนแปลง)
      if (MAR > 0.15) this.lastMouthMoveTime = now;
  
      // กฎ 10 วินาที: ถ้าไม่มีการกะพริบตาหรือขยับปากเลย ถือว่าเอารูปถ่ายมาบังกล้อง
      const timeSinceBlink = now - this.lastBlinkTime;
      const timeSinceMouth = now - this.lastMouthMoveTime;
      const isAlive = (timeSinceBlink < this.SPOOFING_TIMEOUT) || (timeSinceMouth < this.SPOOFING_TIMEOUT);
  
      return { avgEAR, MAR, isAlive, timeSinceBlink };
    }
  
    getEAR(face, p1, p2, p3, p4, p5, p6) {
      // สูตรคำนวณ EAR ตามสากล: (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
      const v1 = Math.hypot(face[p2].x - face[p6].x, face[p2].y - face[p6].y);
      const v2 = Math.hypot(face[p3].x - face[p5].x, face[p3].y - face[p5].y);
      const h = Math.hypot(face[p1].x - face[p4].x, face[p1].y - face[p4].y);
      return h > 0 ? (v1 + v2) / (2.0 * h) : 1;
    }
  
    // ==========================================
    // 3. Gaze Detection
    // ==========================================
    calculateGaze(face) {
      if (face.length < 474) return { text: 'CENTER' }; // ต้องมีจุด Iris (468-477)
  
      const leftEyeW = Math.abs(face[133].x - face[33].x);
      const leftIrisRatio = leftEyeW > 0 ? (face[468].x - Math.min(face[33].x, face[133].x)) / leftEyeW : 0.5;
      
      const rightEyeW = Math.abs(face[362].x - face[263].x);
      const rightIrisRatio = rightEyeW > 0 ? (face[473].x - Math.min(face[362].x, face[263].x)) / rightEyeW : 0.5;
  
      const avgIrisX = (leftIrisRatio + rightIrisRatio) / 2;
      
      let text = 'CENTER';
      if (avgIrisX < 0.3) text = 'LOOKING_RIGHT';
      else if (avgIrisX > 0.7) text = 'LOOKING_LEFT';
  
      return { irisRatioX: avgIrisX, text };
    }
  
    // ==========================================
    // 4. Lighting & Occlusion Check
    // ==========================================
    checkLightingAndOcclusion(face, videoElement) {
      // ตรวจสอบการถูกบัง (Occlusion) 
      // ถ้าจมูกและตาอยู่ชิดกันผิดปกติเกินไป (เช่น เอามือมาบีบหรือโครงหน้าเพี้ยนเพราะมีสิ่งรบกวน)
      const eyeDist = Math.hypot(face[263].x - face[33].x, face[263].y - face[33].y);
      const noseToEye = Math.hypot(face[1].x - face[33].x, face[1].y - face[33].y);
      const isOccluded = (noseToEye / eyeDist) < 0.2 || (noseToEye / eyeDist) > 1.5;
  
      // ตรวจสอบสภาพแสงผ่าน Canvas ย่อส่วน (เพื่อประหยัด CPU)
      let isLightingGood = true;
      let brightness = 125; // ค่ากลางสมมติ
  
      if (videoElement && videoElement.readyState >= 2) {
        // วาดวิดีโอลงบนผืนผ้าใบ 32x32 px
        this.lightCtx.drawImage(videoElement, 0, 0, 32, 32);
        const imageData = this.lightCtx.getImageData(0, 0, 32, 32);
        const data = imageData.data;
        
        let r = 0, g = 0, b = 0;
        // สุ่มข้ามพิกเซล (Step 4) เพื่อให้อ่านค่าเร็วขึ้น (Performance Optimization)
        let count = 0;
        for (let i = 0; i < data.length; i += 16) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        
        // คำนวณความสว่างตามสมการ Perceived Luminance
        brightness = Math.floor((0.299 * (r/count)) + (0.587 * (g/count)) + (0.114 * (b/count)));
        
        // น้อยกว่า 40 = มืดไป, มากกว่า 240 = สว่างจ้าเกินไป (ย้อนแสง)
        isLightingGood = brightness > 40 && brightness < 240;
      }
  
      return { brightness, isLightingGood, isOccluded };
    }

    // ==========================================
    // 5. Glass Glare Detection (แสงสะท้อนบนเลนส์แว่น)
    // ==========================================
    checkGlassGlare(face, videoElement) {
      if (!videoElement || videoElement.readyState < 2) return false;
      
      const vw = videoElement.videoWidth || 640;
      const vh = videoElement.videoHeight || 480;

      // ฟังก์ชันดึงกรอบดวงตาพร้อม Padding ขยายออกไปรอบๆ เพื่อครอบคลุมเลนส์แว่น
      const getEyeBox = (p1, p2, p3, p4) => {
        const minX = Math.min(face[p1].x, face[p2].x) * vw;
        const maxX = Math.max(face[p1].x, face[p2].x) * vw;
        const minY = Math.min(face[p3].y, face[p4].y) * vh;
        const maxY = Math.max(face[p3].y, face[p4].y) * vh;
        const padX = (maxX - minX) * 0.2; // เผื่อขอบซ้ายขวา 20%
        const padY = (maxY - minY) * 0.5; // เผื่อขอบบนล่าง 50%
        return { 
          x: Math.max(0, minX - padX), y: Math.max(0, minY - padY), 
          w: (maxX - minX) + (padX * 2), h: (maxY - minY) + (padY * 2) 
        };
      };

      const leftEye = getEyeBox(33, 133, 159, 145);
      const rightEye = getEyeBox(362, 263, 386, 374);
      if (leftEye.w <= 0 || rightEye.w <= 0) return false;

      // วาดเฉพาะส่วนดวงตาลงบน Canvas ขนาดจิ๋ว (ตาละ 32x16 px) เพื่อความรวดเร็ว
      this.glareCtx.drawImage(videoElement, leftEye.x, leftEye.y, leftEye.w, leftEye.h, 0, 0, 32, 16);
      this.glareCtx.drawImage(videoElement, rightEye.x, rightEye.y, rightEye.w, rightEye.h, 32, 0, 32, 16);

      const imgData = this.glareCtx.getImageData(0, 0, 64, 16).data;
      let glarePixelCount = 0;
      const totalPixels = 64 * 16;

      // วนลูปหาพิกเซลที่ "สว่างจ้า" จนกลายเป็นสีขาว (RGB > 245)
      for (let i = 0; i < imgData.length; i += 4) {
        if (imgData[i] > 245 && imgData[i+1] > 245 && imgData[i+2] > 245) glarePixelCount++;
      }

      // สมการ Area Ratio: ถ้าแสงสีขาวกินพื้นที่เกิน 12% ของบริเวณตา ถือว่ามีแสงสะท้อนรุนแรง
      return (glarePixelCount / totalPixels) > 0.12;
    }
  }