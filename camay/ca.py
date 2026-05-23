import cv2
import time
import os
import threading
# คอมเมนต์ หรือ ลบบรรทัด load_dotenv() ทิ้งไปก่อน
# from dotenv import load_dotenv 
import google.generativeai as genai
from PIL import Image
import mediapipe as mp

# ==========================================
# 1. ตั้งค่าและเชื่อมต่อ Gemini API
# ==========================================
# load_dotenv()  <-- คอมเมนต์ทิ้ง
# API_KEY = os.getenv("GEMINI_API_KEY") <-- คอมเมนต์ทิ้ง

# ใส่ API Key ใหม่ของคุณลงไปตรงๆ แบบนี้เลย (เอาไว้ทดสอบชั่วคราว)
API_KEY = "IzaSyDg032uiy21BfP8ZrgsHoxHGnCIW5BzffU"

if not API_KEY:
    print("❌ Error: ไม่พบ API Key!")
    exit()

genai.configure(api_key=API_KEY)
model = genai.GenerativeModel('gemini-1.5-pro')

# ... (โค้ดส่วนที่เหลือเหมือนเดิม) ...

# ==========================================
# 2. ตั้งค่า MediaPipe Face Mesh
# ==========================================
mp_face_mesh = mp.solutions.face_mesh
# กำหนด refine_landmarks=True เพื่อให้ตรวจจับตาดำ (Iris) ได้
face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True, 
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles

# ==========================================
# 3. ตั้งค่ากล้อง
# ==========================================
cap = cv2.VideoCapture(0) # แนะนำให้ใช้ 0 หากคอมพิวเตอร์มีกล้องตัวเดียว
last_analyze_time = 0
analysis_interval = 5.0
gemini_status = "Waiting for Gemini..."

def analyze_image_with_gemini(rgb_image):
    global gemini_status
    pil_img = Image.fromarray(rgb_image)
    prompt = """
    Analyze this webcam image. Check for:
    1. No face
    2. Multiple people
    3. Using a phone/device
    Reply ONLY with: 'NORMAL', 'CHEATING: No Face', 'CHEATING: Multiple People', or 'CHEATING: Using Device'.
    """
    try:
        response = model.generate_content([prompt, pil_img])
        gemini_status = response.text.strip()
    except Exception:
        gemini_status = "API Error"

print("✅ ระบบพร้อมใช้งาน! มีทั้ง Face Mesh และ Gemini (กด 'q' เพื่อออก)")

while True:
    ret, frame = cap.read()
    if not ret:
        break

    # พลิกภาพให้เหมือนกระจก (ซ้ายเป็นซ้าย ขวาเป็นขวา)
    frame = cv2.flip(frame, 1)
    h, w, _ = frame.shape
    current_time = time.time()

    # แปลงภาพเป็น RGB สำหรับใช้งานทั้ง MediaPipe และ Gemini
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    # ==========================================
    # 4. ส่วนของ MediaPipe Face Mesh (ทำงานทุกเฟรม)
    # ==========================================
    results = face_mesh.process(rgb_frame)
    
    head_direction = "Center"
    gaze_direction = "Center"

    if results.multi_face_landmarks:
        for face_landmarks in results.multi_face_landmarks:
            # วาดเส้น Face Mesh บางๆ บนหน้า
            mp_drawing.draw_landmarks(
                image=frame,
                landmark_list=face_landmarks,
                connections=mp_face_mesh.FACEMESH_TESSELATION,
                landmark_drawing_spec=None,
                connection_drawing_spec=mp_drawing_styles.get_default_face_mesh_tesselation_style()
            )

            # --- คำนวณการหันหน้า (Head Pose) ---
            # ใช้จุด: จมูก(1), แก้มซ้าย(234), แก้มขวา(454)
            nose_x = face_landmarks.landmark[1].x
            left_cheek_x = face_landmarks.landmark[234].x
            right_cheek_x = face_landmarks.landmark[454].x
            
            # แก้บั๊กค่าติดลบจากการ Flip ภาพ
            min_cheek_x = min(left_cheek_x, right_cheek_x)
            max_cheek_x = max(left_cheek_x, right_cheek_x)
            face_width = max_cheek_x - min_cheek_x
            if face_width > 0:
                nose_ratio = (nose_x - min_cheek_x) / face_width
                if nose_ratio < 0.4:
                    head_direction = "Turning Right" # ผู้สอบหันไปทางขวาของตัวเอง
                elif nose_ratio > 0.6:
                    head_direction = "Turning Left"  # ผู้สอบหันไปทางซ้ายของตัวเอง
                else:
                    head_direction = "Looking Center"

            # --- คำนวณการมองของดวงตา (Eye Gaze) ---
            # ใช้ตาขวาของผู้สอบ: หางตา(33), หัวตา(133), กลางตาดำ(473)
            outer_eye_x = face_landmarks.landmark[33].x
            inner_eye_x = face_landmarks.landmark[133].x
            iris_x = face_landmarks.landmark[473].x
            
            # แก้บั๊กค่าติดลบจากการ Flip ภาพ
            min_eye_x = min(outer_eye_x, inner_eye_x)
            max_eye_x = max(outer_eye_x, inner_eye_x)
            eye_width = max_eye_x - min_eye_x
            if eye_width > 0:
                iris_ratio = (iris_x - min_eye_x) / eye_width
                if iris_ratio < 0.4:
                    gaze_direction = "Looking Right" # ตาดำมองไปทางขวา
                elif iris_ratio > 0.6:
                    gaze_direction = "Looking Left"  # ตาดำมองไปทางซ้าย
                else:
                    gaze_direction = "Looking Center"

            # วาดจุดตาดำให้เห็นชัดๆ (สีแดง)
            cx, cy = int(iris_x * w), int(face_landmarks.landmark[473].y * h)
            cv2.circle(frame, (cx, cy), 3, (0, 0, 255), -1)

    else:
        head_direction = "NO FACE DETECTED"
        gaze_direction = "-"

    # ==========================================
    # 5. ส่วนของ Gemini (ทำงานทุกๆ 5 วินาที)
    # ==========================================
    if current_time - last_analyze_time > analysis_interval:
        # โยนภาระให้ Thread ย่อยจัดการ เพื่อให้วิดีโอหลักไหลลื่นไม่กระตุก
        threading.Thread(target=analyze_image_with_gemini, args=(rgb_frame.copy(),), daemon=True).start()
        last_analyze_time = current_time

    # ==========================================
    # 6. แสดงผลบนหน้าจอวิดีโอ
    # ==========================================
    # แถบพื้นหลังข้อความ
    cv2.rectangle(frame, (10, 10), (600, 100), (0, 0, 0), -1)
    
    # แสดงผล Gemini (ภาพรวม)
    color_ai = (0, 0, 255) if "CHEAT" in gemini_status.upper() else (0, 255, 0)
    cv2.putText(frame, f"Gemini Status: {gemini_status}", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color_ai, 2)
    
    # แสดงผล MediaPipe (ทิศทางหน้าและดวงตา)
    color_head = (0, 165, 255) if head_direction != "Looking Center" else (0, 255, 0)
    cv2.putText(frame, f"Head: {head_direction}", (20, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color_head, 2)
    cv2.putText(frame, f"Eyes: {gaze_direction}", (300, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color_head, 2)

    cv2.imshow("Smart Proctor AI (MediaPipe + Gemini)", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()