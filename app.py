from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from datetime import datetime
import secrets
import requests
from dotenv import load_dotenv

load_dotenv()  # Load environment variables

OLLAMA_API_URL = os.getenv('OLLAMA_API_URL')

app = Flask(__name__)
# 修复CORS配置，使用列表指定来源
CORS(app, resources={r"/*": {
    "origins": ["https://www.tradingview.com"],  # 使用列表形式
    "methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["Authorization"]
}})

UPLOAD_DIR = 'images'
os.makedirs(UPLOAD_DIR, exist_ok=True)

VALID_TOKEN = 'your_secret_token_here'

@app.route('/upload', methods=['POST', 'OPTIONS'])
def upload_screenshot():
    if request.method == 'OPTIONS':
        response = jsonify({'message': 'Preflight request'})
        response.headers.add('Access-Control-Allow-Origin', 'https://www.tradingview.com')
        response.headers.add('Access-Control-Allow-Headers', 'Authorization')
        return response, 200

    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'No token provided'}), 401
        
        token = auth_header.split(' ')[1]
        if token != VALID_TOKEN:
            return jsonify({'error': 'Invalid token'}), 401

        if 'screenshot' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['screenshot']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        random_hex = secrets.token_hex(4)
        filename = f'screenshot_{timestamp}_{random_hex}.png'
        file_path = os.path.join(UPLOAD_DIR, filename)
        file.save(file_path)

        # Send image to Ollama API
        with open(file_path, 'rb') as img_file:
            files = {'image': img_file}
            response = requests.post(OLLAMA_API_URL, files=files)
            
        if response.status_code == 200:
            # Parse and return the JSON response
            response = jsonify(response.json())
            response.headers.add('Access-Control-Allow-Origin', 'https://www.tradingview.com')
            return response
        else:
            response = jsonify({'error': f'Ollama API error: {response.status_code}'})
            response.headers.add('Access-Control-Allow-Origin', 'https://www.tradingview.com')
            return response, 500

    except Exception as e:
        response = jsonify({'error': str(e)})
        response.headers.add('Access-Control-Allow-Origin', 'https://www.tradingview.com')
        return response, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005, debug=True)