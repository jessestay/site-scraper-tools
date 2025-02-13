import uvicorn
from ai_server import app

if __name__ == '__main__':
    print("Starting AI server...")
    print("1. Open Chrome extension")
    print("2. Choose 'Smart WordPress Migration'")
    print("3. Follow the guided process")
    uvicorn.run(app, host="127.0.0.1", port=8080) 