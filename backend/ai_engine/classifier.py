"""
CityShield AI — Violence Classifier Model Architecture
MobileNetV2 CNN feature extractor + Bidirectional LSTM temporal classifier.
"""
import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms
from config import WEIGHTS_PATH


class ViolenceClassifier(nn.Module):
    def __init__(self, hidden_size=256, num_layers=2, num_classes=2):
        super(ViolenceClassifier, self).__init__()
        mobilenet = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.DEFAULT)
        self.cnn  = nn.Sequential(*list(mobilenet.children())[:-1])
        self.lstm = nn.LSTM(
            input_size=1280, hidden_size=hidden_size,
            num_layers=num_layers, batch_first=True,
            bidirectional=True, dropout=0.5
        )
        self.dropout = nn.Dropout(0.5)
        self.fc      = nn.Linear(hidden_size * 2, num_classes)

    def forward(self, x):
        batch_size, seq_length, c, h, w = x.size()
        x        = x.view(batch_size * seq_length, c, h, w)
        c_out    = self.cnn(x).mean([2, 3])
        r_in     = c_out.view(batch_size, seq_length, -1)
        lstm_out, _ = self.lstm(r_in)
        final    = self.dropout(lstm_out[:, -1, :])
        return self.fc(final)


# ─────────────────────────────────────────────────────────────────────────────
# Shared model instances — loaded once at import time
# ─────────────────────────────────────────────────────────────────────────────
print("Loading AI Models... Please wait.")
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

from ultralytics import YOLO
from config import YOLO_MODEL_PATH

yolo_model   = YOLO(YOLO_MODEL_PATH)
action_model = ViolenceClassifier().to(device)

try:
    action_model.load_state_dict(torch.load(WEIGHTS_PATH, map_location=device))
    print("Model weights loaded successfully.")
except FileNotFoundError:
    print("Warning: Weights not found. Running with uninitialized weights for UI testing.")

action_model.eval()

transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])
print("AI Core Online.")
