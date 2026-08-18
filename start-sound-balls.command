#!/bin/bash
# Serves Sound Balls on localhost so the browser allows microphone access.
cd "$(dirname "$0")"
PORT=8765
( sleep 1; open "http://localhost:$PORT/sound-balls.html" ) &
echo "Sound Balls running at http://localhost:$PORT/sound-balls.html"
echo "Keep this window open. Press Ctrl+C to stop."
python3 -m http.server $PORT
