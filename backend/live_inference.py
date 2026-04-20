import cv2
import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms
import numpy as np
from collections import deque
from ultralytics import YOLO

# 1. The Exact Brain Architecture (Must match Kaggle exactly)
class ViolenceClassifier(nn.Module):
    def __init__(self, hidden_size=256, num_layers=2, num_classes=2):
        super(ViolenceClassifier, self).__init__()
        mobilenet = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.DEFAULT)
        self.cnn = nn.Sequential(*list(mobilenet.children())[:-1])
        self.lstm = nn.LSTM(input_size=1280, hidden_size=hidden_size, num_layers=num_layers, batch_first=True, bidirectional=True, dropout=0.5)
        self.dropout = nn.Dropout(0.5)
        self.fc = nn.Linear(hidden_size * 2, num_classes)

    def forward(self, x):
        batch_size, seq_length, c, h, w = x.size()
        x = x.view(batch_size * seq_length, c, h, w)
        c_out = self.cnn(x).mean([2, 3]) 
        r_in = c_out.view(batch_size, seq_length, -1)
        lstm_out, _ = self.lstm(r_in)
        final_decision = self.dropout(lstm_out[:, -1, :])
        return self.fc(final_decision)

def run_smart_city_system():
    print("Loading AI Models... Please wait.")
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Running inference on: {device.type.upper()}")
    
    yolo_model = YOLO('yolov8n.pt')
    action_model = ViolenceClassifier().to(device)
    weights_path = 'ai_engine/weights/violence_model_v2_high_acc.pth' 
    action_model.load_state_dict(torch.load(weights_path, map_location=device))
    action_model.eval() 

    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])

    sequence_buffer = deque(maxlen=30)
    classes = ['Normal Activity', 'VIOLENCE DETECTED!']
    current_status = "Waiting for time buffer..."
    box_color = (0, 255, 0) 
    
    # --- OPTIMIZATION & TEMPORAL UPGRADES ---
    frame_count = 0
    inference_stride = 10  # Only run the heavy brain every 10 frames
    capture_stride = 4     # Only save 1 frame to memory every 4 frames (simulates CCTV time)

    # To test with a video file instead of webcam, replace 0 with the video path
    cap = cv2.VideoCapture(0)
    print("System Armed. Opening Webcam...")

    while cap.isOpened():
        success, frame = cap.read()
        if not success: break
        
        frame_count += 1 # Tick the counter

        results = yolo_model(frame, classes=[0], verbose=False)
        annotated_frame = frame.copy()

        if len(results[0].boxes) > 0:
            box = results[0].boxes[0].xyxy[0].cpu().numpy()
            x1, y1, x2, y2 = map(int, box)
            
            y1, y2 = max(0, y1), min(frame.shape[0], y2)
            x1, x2 = max(0, x1), min(frame.shape[1], x2)

            if y2 > y1 and x2 > x1:
                # --- NEW TEMPORAL SAMPLING LOGIC ---
                # Only add to the sequence memory every 4th frame
                if frame_count % capture_stride == 0:
                    cropped_human = frame[y1:y2, x1:x2]
                    resized_crop = cv2.resize(cropped_human, (224, 224))
                    
                    rgb_frame = cv2.cvtColor(resized_crop, cv2.COLOR_BGR2RGB)
                    tensor_frame = transform(rgb_frame)
                    sequence_buffer.append(tensor_frame)

                # --- THE STRIDE LOGIC ---
                # Predict only if memory is full AND we hit our inference stride interval
                if len(sequence_buffer) == 30 and frame_count % inference_stride == 0:
                    input_tensor = torch.stack(list(sequence_buffer)).unsqueeze(0).to(device)
                    
                    with torch.no_grad(): 
                        output = action_model(input_tensor)
                        _, predicted = torch.max(output.data, 1)
                        label_idx = predicted.item()
                        
                        current_status = classes[label_idx]
                        box_color = (0, 0, 255) if label_idx == 1 else (0, 255, 0) 

                # Draw the box and text
                cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), box_color, 2)
                cv2.putText(annotated_frame, current_status, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, box_color, 2)

        cv2.imshow("Smart City AI Core: Real-Time Monitoring", annotated_frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    run_smart_city_system()