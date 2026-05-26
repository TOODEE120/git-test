import cv2
import mediapipe as mp
from ultralytics import YOLO
from collections import deque
import statistics
import threading
import time

# ==========================================
# 1. Threaded Video Capture (ลดอาการกระตุกจากกล้อง)
# ==========================================
class VideoStream:
    def __init__(self, src=0, width=640, height=480):
        self.stream = cv2.VideoCapture(src)
        self.stream.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.stream.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        (self.grabbed, self.frame) = self.stream.read()
        self.stopped = False

    def start(self):
        # รันการดึงภาพใน Thread แยก
        threading.Thread(target=self.update, args=(), daemon=True).start()
        return self

    def update(self):
        while not self.stopped:
            (self.grabbed, self.frame) = self.stream.read()

    def read(self):
        return self.frame

    def stop(self):
        self.stopped = True
        self.stream.release()

# ==========================================
# 2. การตั้งค่าระบบต่างๆ (Configuration)
# ==========================================
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=2, 
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

# ใช้โมเดล nano สำหรับสมดุลความเร็วกับความแม่นยำ
try:
    model = YOLO('yolov8n.pt')
except:
    print('[WARNING] Unable to load yolov8n.pt, will attempt online download')
    model = YOLO('yolov8n.pt')

# โหลดโมเดล Custom ของเราเพื่อจับโพยกระดาษโดยเฉพาะ (หากมี)
try:
    custom_model = YOLO('best.pt')
except:
    print('[WARNING] Custom model not found, using base model only')
    custom_model = None 

RESTRICTED_CLASSES = [63, 67, 73]  # 63: laptop, 67: cell phone, 73: book/paper
CONFIDENCE_THRESHOLD = 0.5  # ปรับขึ้นจาก 0.4 เพื่อลด false positive

gaze_history = deque(maxlen=10)  # เพิ่มประวัติเพื่อให้ smooth มากขึ้น

# ตัวแปรสำหรับ Frame Skipping ของ YOLO
frame_count = 0
YOLO_SKIP_FRAMES = 8  # ลดลงเพื่อให้มันสลับรัน 2 โมเดลได้บ่อยขึ้น

# แยก Cache กล่องข้อความของแต่ละโมเดล
last_base_alerts, last_base_boxes = [], []
last_custom_alerts, last_custom_boxes = [], []
yolo_turn_is_base = True # ตัวแปรสลับคิว (Round Robin)

# ตัวแปรคำนวณ FPS
prev_time = 0

# เริ่มเปิดกล้องแบบ Threaded
cap = VideoStream(src=0).start()
time.sleep(1.0) # รอให้กล้องวอร์มอัพ

while True:
    frame = cap.read()
    if frame is None:
        break

    ih, iw, _ = frame.shape
    alerts = []
    frame_count += 1

    # ==========================================
    # 3. ตรวจจับสิ่งของด้วย YOLO (แบบข้ามเฟรม - Frame Skipping)
    # ==========================================
    # รัน YOLO แค่บางเฟรมเพื่อลดภาระ CPU
    if frame_count % YOLO_SKIP_FRAMES == 0:
        if yolo_turn_is_base:
            try:
                # --- คิวรันโมเดลหลัก ---
                last_base_alerts.clear()
                last_base_boxes.clear()
                results = model(frame, imgsz=320, conf=CONFIDENCE_THRESHOLD, verbose=False)
                for r in results:
                    for box in r.boxes:
                        cls = int(box.cls[0])
                        if cls in RESTRICTED_CLASSES:
                            x1, y1, x2, y2 = map(int, box.xyxy[0])
                            conf = float(box.conf[0])
                            label_name = model.names[cls]
                            if cls == 73:
                                label_name = "book/paper"
                            last_base_boxes.append((x1, y1, x2, y2, label_name))
                            last_base_alerts.append(f"Restricted item: {label_name} ({conf:.0%})")
            except Exception as e:
                print(f'[ERROR] Base YOLO failed: {e}')
        else:
            # --- คิวรันโมเดล Custom (โพยกระดาษ) ---
            if custom_model is not None:
                try:
                    last_custom_alerts.clear()
                    last_custom_boxes.clear()
                    custom_results = custom_model(frame, imgsz=480, conf=0.5, verbose=False)
                    for r in custom_results:
                        for box in r.boxes:
                            cls = int(box.cls[0])
                            if cls == 0: 
                                x1, y1, x2, y2 = map(int, box.xyxy[0])
                                conf = float(box.conf[0])
                                last_custom_boxes.append((x1, y1, x2, y2, "CHEAT SHEET"))
                                last_custom_alerts.append(f"Restricted item: cheat sheet ({conf:.0%})")
                except Exception as e:
                    print(f'[ERROR] Custom YOLO failed: {e}')
                        
        # สลับคิวให้โมเดลอีกตัวรันในรอบถัดไป
        yolo_turn_is_base = not yolo_turn_is_base

    # วาดกรอบและแจ้งเตือนจากข้อมูล YOLO ล่าสุดที่เก็บไว้ (Cache)
    for (x1, y1, x2, y2, label_name) in last_base_boxes + last_custom_boxes:
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
        cv2.putText(frame, f"ITEM: {label_name.upper()}", (x1, y1 - 10), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
    
    alerts.extend(last_base_alerts)
    alerts.extend(last_custom_alerts)

    # ==========================================
    # 4. ตรวจจับใบหน้าด้วย MediaPipe (รันทุกเฟรมเพื่อให้การมองลื่นไหล)
    # ==========================================
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mesh_results = face_mesh.process(rgb_frame)

    if mesh_results.multi_face_landmarks:
        num_faces = len(mesh_results.multi_face_landmarks)
        if num_faces > 1:
            alerts.append(f"MULTIPLE PERSONS ({num_faces} faces)!")
        
        face_landmarks = mesh_results.multi_face_landmarks[0]
        
        top_y = face_landmarks.landmark[386].y * ih
        bottom_y = face_landmarks.landmark[374].y * ih
        pupil_y = face_landmarks.landmark[473].y * ih
        
        eye_height = bottom_y - top_y
        
        if eye_height > 0:
            current_gaze_ratio = (pupil_y - top_y) / eye_height
            gaze_history.append(current_gaze_ratio)
            
            avg_gaze_ratio = statistics.mean(gaze_history)
            
            gaze_status = "Looking CENTER"
            gaze_color = (255, 0, 0)
            
            if avg_gaze_ratio < 0.38:
                gaze_status = "Looking UP"
                gaze_color = (0, 165, 255)
                alerts.append("Looking UP!")
            elif avg_gaze_ratio > 0.62:
                gaze_status = "Looking DOWN"
                gaze_color = (0, 165, 255)
                alerts.append("Looking DOWN!")
                
            cv2.putText(frame, f"Gaze: {gaze_status}", (20, 70), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, gaze_color, 2)
    else:
        alerts.append("NO FACE DETECTED!")
        gaze_history.clear()

    # ==========================================
    # 5. แสดงผล FPS และการแจ้งเตือน
    # ==========================================
    # คำนวณ FPS
    curr_time = time.time()
    fps = 1 / (curr_time - prev_time) if prev_time > 0 else 0
    prev_time = curr_time
    cv2.putText(frame, f"FPS: {int(fps)}", (20, 40), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

    # แจ้งเตือนรวมศูนย์
    if alerts:
        cv2.rectangle(frame, (0, 0), (iw, ih), (0, 0, 255), 5)
        y_offset = 40
        for alert_msg in set(alerts):
            cv2.putText(frame, alert_msg, (iw - 350, y_offset), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
            y_offset += 30

    cv2.imshow('High-Performance Proctoring', frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.stop()
cv2.destroyAllWindows()
# # สำหรับเครื่องที่มีการ์ดจอ NVIDIA
# model = YOLO('yolov8n.pt') 
# results = model(frame, imgsz=480, verbose=False, device='0') 
# 
# # หรือสำหรับ Mac ชิป M1/M2/M3 (Apple Silicon) ให้ใช้ 'mps'
# results = model(frame, imgsz=480, verbose=False, device='mps')
