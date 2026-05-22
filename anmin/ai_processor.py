import os
import time
import json
import math
import cv2
import requests
import socketio
from datetime import datetime

try:
    import mediapipe as mp
except ImportError:
    mp = None

SERVER_URL = os.getenv('AI_SERVER_URL', 'http://localhost:3000')
HTTP_ENDPOINT = f'{SERVER_URL}/api/event'
SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), 'snapshots')

if not os.path.exists(SNAPSHOT_DIR):
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)

sio = socketio.Client()

try:
    sio.connect(SERVER_URL, transports=['websocket'])
    print('Connected to Socket.IO server')
except Exception as exc:
    print('Socket.IO connection failed:', exc)

students = [
    {'studentId': 'std_01', 'name': 'สมชาย', 'grade': 'ม.6/1'},
    {'studentId': 'std_02', 'name': 'อารีน่า', 'grade': 'ม.6/1'},
    {'studentId': 'std_03', 'name': 'จอห์น', 'grade': 'ม.6/2'},
    {'studentId': 'std_04', 'name': 'ไมค์', 'grade': 'ม.6/3'},
    {'studentId': 'std_05', 'name': 'นที', 'grade': 'ม.6/2'},
    {'studentId': 'std_06', 'name': 'สุดา', 'grade': 'ม.6/3'},
]

mp_face_mesh = None

if mp:
    mp_face_mesh = mp.solutions.face_mesh.FaceMesh(
        min_detection_confidence=0.6,
        min_tracking_confidence=0.5,
        max_num_faces=1
    )


def send_event(payload):
    try:
        if sio.connected:
            sio.emit('ai:update', payload)
    except Exception:
        pass

    try:
        requests.post(HTTP_ENDPOINT, json=payload, timeout=3)
    except Exception:
        pass


def save_snapshot(frame, student_id):
    filename = f'{student_id}_{int(time.time())}.jpg'
    path = os.path.join(SNAPSHOT_DIR, filename)
    cv2.imwrite(path, frame)
    return f'snapshots/{filename}'


def calculate_head_turn_ratio(landmarks, image_width, image_height):
    left_eye = landmarks[33]
    right_eye = landmarks[263]
    nose_tip = landmarks[1]
    eye_line = abs((left_eye.x - right_eye.x) * image_width)
    nose_offset = (nose_tip.x - 0.5) * image_width
    score = abs(nose_offset) / max(1, eye_line)
    return score


def build_payload(student, event_type, message, risk_score, confidence, snapshot_url=None):
    return {
        'studentId': student['studentId'],
        'name': student['name'],
        'grade': student['grade'],
        'eventType': event_type,
        'message': message,
        'riskScore': risk_score,
        'confidence': confidence,
        'snapshotUrl': snapshot_url,
        'timestamp': datetime.now().strftime('%H:%M:%S')
    }


def run_dummy_simulation():
    print('Running dummy event simulation...')
    while True:
        student = students[int(time.time()) % len(students)]
        risk = 30 + int(time.time() % 70)
        conf = 55 + int((time.time() * 3) % 45)
        event_type = 'warning' if risk >= 50 else 'info'
        message = 'ตรวจจับพฤติกรรมผิดปกติ' if event_type == 'warning' else 'สถานะปกติ'
        payload = build_payload(student, event_type, message, risk, conf)
        send_event(payload)
        print('Sent dummy event:', payload)
        time.sleep(8)


def run_opencv_monitor():
    if not mp_face_mesh:
        print('MediaPipe not installed; falling back to dummy simulation.')
        run_dummy_simulation()
        return

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print('Webcam not found; falling back to dummy simulation.')
        run_dummy_simulation()
        return

    print('Starting video monitor. Press q to stop.')
    student = students[0]
    frame_counter = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = mp_face_mesh.process(image_rgb)

        risk = 25
        confidence = 80
        event_type = 'info'
        message = 'ใบหน้าพบปกติ'
        snapshot_url = None

        if results.multi_face_landmarks:
            face_landmarks = results.multi_face_landmarks[0].landmark
            turn_score = calculate_head_turn_ratio(face_landmarks, frame.shape[1], frame.shape[0])
            if turn_score > 0.22:
                risk = 78
                confidence = int(min(98, 50 + turn_score * 120))
                event_type = 'warning'
                message = 'ตรวจจับการหันหน้า / ละสายตา'
                snapshot_url = save_snapshot(frame, student['studentId'])
            else:
                risk = 28
                confidence = 86
                message = 'มองหน้าจอปกติ'
        else:
            risk = 92
            confidence = 90
            event_type = 'danger'
            message = 'ไม่พบใบหน้าในเฟรม'
            snapshot_url = save_snapshot(frame, student['studentId'])

        payload = build_payload(student, event_type, message, risk, confidence, snapshot_url)
        send_event(payload)
        print('Sent event:', payload)

        frame_counter += 1
        if frame_counter % 10 == 0:
            cv2.imshow('AI Processor (press q to exit)', frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == '__main__':
    run_opencv_monitor()
