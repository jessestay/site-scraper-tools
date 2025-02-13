from pathlib import Path
import subprocess
import sys
import os

def setup_environment():
    """Set up the AI environment with minimal user interaction"""
    print("Setting up Site Migration Assistant...")
    
    # Create virtual environment if needed
    if not Path('venv').exists():
        subprocess.run([sys.executable, '-m', 'venv', 'venv'])
    
    # Activate virtual environment
    if os.name == 'nt':  # Windows
        activate_script = 'venv\\Scripts\\activate'
    else:  # Unix
        activate_script = 'venv/bin/activate'
    
    # Install requirements
    subprocess.run([
        'pip', 'install',
        'fastapi',
        'uvicorn',
        'llama-cpp-python',
        'pydantic'
    ])
    
    # Download model if needed
    model_path = Path('models/mistral-7b-instruct-v0.2.Q4_K_M.gguf')
    if not model_path.exists():
        print("Downloading AI model (this may take a few minutes)...")
        model_path.parent.mkdir(exist_ok=True)
        subprocess.run([
            'curl', '-L',
            'https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf',
            '-o', str(model_path)
        ])

    print("\n✓ Setup complete! Run 'python run_server.py' to start")

if __name__ == '__main__':
    setup_environment() 