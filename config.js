/**
 * PROCTOR System Configuration
 * Central configuration for all detection thresholds and parameters
 */

export const CONFIG = {
  // ─── Detection Thresholds ───
  DETECTION: {
    GAZE_THRESHOLD: 8,           // Consecutive frames before gaze alert
    HEAD_THRESHOLD: 8,           // Consecutive frames before head alert
    NOFACE_THRESHOLD: 12,        // Consecutive frames before no-face alert
    MULTIFACE_THRESHOLD: 5,      // Consecutive frames before multiple faces alert
    OBJECT_THRESHOLD: 1,         // Consecutive frames before object alert
    
    // MediaPipe Confidence Thresholds
    FACE_MESH_DETECTION_CONF: 0.4,
    FACE_MESH_TRACKING_CONF: 0.55,
    FACE_DETECTION_CONF: 0.45,
    COCO_SSD_CONFIDENCE: 0.50,
    
    // Cooldown periods (milliseconds)
    GAZE_COOLDOWN: 4000,
    HEAD_COOLDOWN: 4000,
    NOFACE_COOLDOWN: 4000,
    MULTIFACE_COOLDOWN: 5000,
    OBJECT_COOLDOWN: 6000,
  },
  
  // ─── Frame Optimization ───\n  PERFORMANCE: {\n    FRAME_SKIP_FACE_DETECTION: 3,  // Run face detection every 3 frames\n    FRAME_SKIP_OBJECT_DETECTION: 5, // Run object detection every 5 frames\n    MAX_ALERTS_HISTORY: 200,        // Keep last 200 alerts\n    MAX_FACES_TRACKED: 2,           // Maximum faces to track\n  },\n  \n  // ─── Gaze & Head Pose Detection ───\n  GAZE: {\n    EYE_ASPECT_RATIO_THRESHOLD: 0.15,  // Blink detection threshold\n    HEAD_POSE_COMPENSATION: 0.7,       // 3D compensation factor\n    HORIZONTAL_THRESHOLD_LEFT: 0.35,\n    HORIZONTAL_THRESHOLD_RIGHT: 0.65,\n    VERTICAL_THRESHOLD_UP: 0.30,\n    VERTICAL_THRESHOLD_DOWN: 0.70,\n  },\n  \n  // ─── Suspicious Objects ───\n  SUSPICIOUS_OBJECTS: [\n    'cell phone',\n    'book',\n    'laptop',\n    'remote',\n    'tablet',\n  ],\n  \n  // ─── UI/UX Settings ───\n  UI: {\n    DANGER_FLASH_DURATION: 800,  // ms\n    LOADING_MESSAGE_UPDATE_INTERVAL: 500,  // ms\n    STATS_UPDATE_INTERVAL: 500,   // ms\n  },\n  \n  // ─── Alerts Severity Levels ───\n  SEVERITY: {\n    INFO: 'info',\n    WARNING: 'warn',\n    DANGER: 'danger',\n  },\n  \n  // ─── Debug Mode ───\n  DEBUG: {\n    ENABLED: false,\n    LOG_FRAME_RATE: true,\n    LOG_DETECTION_RESULTS: false,\n  },\n};\n\n/**\n * Get configuration value with fallback\n * @param {string} path - dot-notation path (e.g., 'DETECTION.GAZE_THRESHOLD')\n * @param {*} defaultValue - fallback value\n */\nexport function getConfig(path, defaultValue = null) {\n  const keys = path.split('.');\n  let current = CONFIG;\n  \n  for (const key of keys) {\n    if (current?.[key] !== undefined) {\n      current = current[key];\n    } else {\n      return defaultValue;\n    }\n  }\n  \n  return current;\n}\n\n/**\n * Merge custom config with defaults\n */\nexport function mergeConfig(customConfig) {\n  return {\n    ...CONFIG,\n    ...Object.fromEntries(\n      Object.entries(customConfig).map(([key, val]) => [\n        key,\n        typeof val === 'object' && val !== null\n          ? { ...CONFIG[key], ...val }\n          : val\n      ])\n    ),\n  };\n}\n