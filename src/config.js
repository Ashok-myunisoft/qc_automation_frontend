// LOCAL testing
// export const WS_URL = "ws://localhost:8000/ws/qc";

// SERVER 
export const WS_URL = "ws://217.217.249.121:8053/ws/qc";

// Do not change this. It is worked out from the line above (ws -> http, /ws/qc removed).
export const API_BASE = WS_URL.replace(/^ws/, "http").replace(/\/ws\/qc\/?$/, "");