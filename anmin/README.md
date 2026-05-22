# AI Proctor Dashboard Backend

This workspace now contains a frontend dashboard (`ca.html`) plus a backend connector and AI processor prototype.

## Components

- `ca.html`
  - Dashboard UI with real-time incident sidebar, AI confidence gauge, and quick action buttons.
  - Connects to Socket.io server for live updates.

- `server.js`
  - Express server that hosts the dashboard.
  - Socket.io server broadcasts real-time AI events to connected browsers.
  - Receives AI events from Python processor via HTTP and Socket.io.
  - Optional MongoDB storage if `MONGODB_URI` is configured.

- `ai_processor.py`
  - Python prototype using OpenCV and MediaPipe Face Mesh.
  - Detects face presence and head pose, then sends risk updates to the Node server.
  - Saves suspicious snapshots under `snapshots/`.

- `requirements.txt`
  - Python dependencies for OpenCV, MediaPipe, and Socket.IO client.

- `package.json`
  - Node.js dependencies for Express, Socket.io, Mongoose, and CORS.

## Setup

### Node / Express / Socket.io

```bash
cd "d:\Users\Admin\Documents\กล้อง"
npm install
npm start
```

The dashboard will be available at:

```bash
http://localhost:3000
```

### Python AI Processor

Create a virtual environment and install Python dependencies:

```bash
cd "d:\Users\Admin\Documents\กล้อง"
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python ai_processor.py
```

If your machine has a webcam and MediaPipe installed, the processor will run live video detection.

## Notes

- The backend supports MongoDB through the `MONGODB_URI` environment variable.
- Snapshots are served from `http://localhost:3000/snapshots/<filename>`.
- The Python script falls back to dummy event generation if webcam or MediaPipe is unavailable.
