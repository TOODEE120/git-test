from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import os
from dotenv import load_dotenv
import google.generativeai as genai
from PIL import Image
import io
import base64

# ==========================================
# ตั้งค่า Flask Server
# ==========================================
  # กำหนด template_folder='.' เพื่อให้ Flask หาไฟล์ ca.html ที่อยู่โฟลเดอร์เดียวกันเจอ
app = Flask(__name__, template_folder='.')
CORS(app)

# ==========================================
# ตั้งค่า Gemini API
# ==========================================
load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")

if not API_KEY:
    # ใส่ Fallback API Key เพื่อให้ทดสอบได้เหมือนในไฟล์ ca.py
    API_KEY = "IzaSyDg032uiy21BfP8ZrgsHoxHGnCIW5BzffU"
    if not API_KEY:
        print("❌ Error: ไม่พบ API Key! กรุณาตรวจสอบไฟล์ .env")
        exit()

genai.configure(api_key=API_KEY)
model = genai.GenerativeModel('gemini-1.5-pro')

# ==========================================
# Route: หน้าแรก (เสิร์ฟ HTML)
# ==========================================
@app.route('/')
def index():
    return render_template('ca.html')

# ==========================================
# API: วิเคราะห์รูปด้วย Gemini
# ==========================================
@app.route('/api/analyze-image', methods=['POST'])
def analyze_image():
    try:
        # รับภาพจากผู้ใช้ (base64 format)
        data = request.json
        image_data = data.get('image')
        
        if not image_data:
            return jsonify({'error': 'No image provided'}), 400
        
        # แปลง base64 เป็นรูปภาพ
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        image_bytes = base64.b64decode(image_data)
        pil_img = Image.open(io.BytesIO(image_bytes))
        
        # ส่งให้ Gemini วิเคราะห์
        prompt = """
        Analyze this webcam image from an exam proctor system. Check for:
        1. No face detected
        2. Multiple people in frame
        3. Person using a phone/device
        Reply ONLY with ONE of these exact strings:
        - 'NORMAL' (if person is looking at exam normally)
        - 'CHEATING: No Face' (if no face detected)
        - 'CHEATING: Multiple People' (if multiple people)
        - 'CHEATING: Using Device' (if using phone or external device)
        """
        
        response = model.generate_content([prompt, pil_img])
        result = response.text.strip()
        
        return jsonify({'status': result}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==========================================
# API: ตรวจสอบสถานะ Gemini
# ==========================================
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'gemini': 'connected'}), 200

if __name__ == '__main__':
    print("✅ ระบบพร้อมใช้งาน! เปิด http://localhost:5000 ในเบราว์เซอร์")
    app.run(debug=True, host='0.0.0.0', port=5000)
