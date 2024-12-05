from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from datetime import datetime
import secrets

app = Flask(__name__)
CORS(app, resources={r"/*": {
    "origins": "*",  # 允许所有来源，生产时可以替换为具体域名
    "methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization"]  # 显式允许这些头部
}}, supports_credentials=True)

# 创建images目录（如果不存在）
UPLOAD_DIR = 'images'
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

# 模拟简单的token验证
VALID_TOKEN = 'your_secret_token_here'  # 设置你的API Token

@app.route('/upload', methods=['POST', 'OPTIONS'])
def upload_screenshot():
    if request.method == 'OPTIONS':
        # 对预检请求返回允许的CORS头
        response = jsonify({'message': 'Preflight request'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        return response, 200
    try:
        # 验证token
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'No token provided'}), 401
        
        token = auth_header.split(' ')[1]
        if token != VALID_TOKEN:
            return jsonify({'error': 'Invalid token'}), 401

        # 检查是否有文件
        if 'screenshot' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['screenshot']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        # 生成唯一的文件名
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        random_hex = secrets.token_hex(4)
        filename = f'screenshot_{timestamp}_{random_hex}.png'
        
        # 保存文件
        file_path = os.path.join(UPLOAD_DIR, filename)
        file.save(file_path)

        return jsonify({
            'message': 'Screenshot saved successfully',
            'filename': filename
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)