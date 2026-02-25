from ultralytics import YOLO
import cv2
import numpy as np
from collections import deque

def run_temporal_buffer():
    print("Loading YOLOv8 Model...")
    model = YOLO('yolov8n.pt') 
    cap = cv2.VideoCapture(0)

    # --- THE TEMPORAL BUFFER ---
    # This queue holds exactly 30 frames. 
    # When it's full, adding a new frame automatically pushes the oldest one out.
    sequence_buffer = deque(maxlen=30) 

    print("Webcam successfully opened. Press 'q' to quit.")

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            break

        # verbose=False stops YOLO from spamming your terminal with text every single frame
        results = model(frame, classes=[0], verbose=False) 
        annotated_frame = results[0].plot()

        if len(results[0].boxes) > 0:
            box = results[0].boxes[0].xyxy[0].cpu().numpy()
            x1, y1, x2, y2 = map(int, box)

            # Safety check: Prevent coordinates from going off-screen (which crashes OpenCV)
            y1, y2 = max(0, y1), min(frame.shape[0], y2)
            x1, x2 = max(0, x1), min(frame.shape[1], x2)

            # Ensure the crop area is valid
            if y2 > y1 and x2 > x1:
                cropped_human = frame[y1:y2, x1:x2]
                resized_crop = cv2.resize(cropped_human, (224, 224))
                
                # Add the cropped frame to our memory buffer
                sequence_buffer.append(resized_crop)

                cv2.imshow("LSTM Input: Cropped Human", resized_crop)

                # --- THE TRIGGER ---
                # Once we have collected a full sequence of 30 frames, we are ready to predict!
                if len(sequence_buffer) == 30:
                    # We convert it to a NumPy array so the Deep Learning model can read it
                    sequence_array = np.array(sequence_buffer)
                    
                    # Instead of printing on a new line every time, \r overwrites the current line
                    print(f"Buffer Full! Holding {sequence_array.shape} array. Ready for LSTM...", end='\r')

        cv2.imshow("Smart City: Main Camera Feed", annotated_frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    run_temporal_buffer()