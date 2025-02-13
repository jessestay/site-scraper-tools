from fastapi import FastAPI
from pydantic import BaseModel
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from llama_cpp import Llama  # For local GGUF models
import json

app = FastAPI()

# Use GGUF format of Llama-2 or other open models
# These can run on CPU with minimal RAM
llm = Llama(
    model_path="./models/mistral-7b-instruct-v0.2.Q4_K_M.gguf",  # ~4GB file
    n_ctx=4096,  # Context window
    n_threads=4  # Adjust based on your CPU
)

class ContentRequest(BaseModel):
    content: str
    prompt: str

@app.post("/analyze")
async def analyze_content(data: ContentRequest):
    system_prompt = """You are an expert web developer analyzing HTML content.
    Extract key components and structure in JSON format."""
    
    response = llm.create_completion(
        f"{system_prompt}\n\nHTML: {data.content}\n\nAnalysis:",
        max_tokens=1024,
        temperature=0.1,
        stop=["</analysis>"]
    )
    
    try:
        return json.loads(response.choices[0].text)
    except:
        return {"error": "Failed to parse response"}

@app.post("/convert")
async def convert_component(data: ContentRequest):
    system_prompt = """Convert HTML components to WordPress theme format.
    Use standard WordPress template tags and functions."""
    
    response = llm.create_completion(
        f"{system_prompt}\n\nHTML: {data.content}\n\nWordPress Theme Code:",
        max_tokens=1024,
        temperature=0.1
    )
    
    return {"code": response.choices[0].text}

@app.post("/extract-topics")
async def extract_topics(data: ContentRequest):
    response = llm.create_completion(
        f"Extract main topics and tags from this content: {data.content}",
        max_tokens=256,
        temperature=0.3
    )
    
    return {
        "mainTopics": response.choices[0].text.split('\n')[:3],
        "relatedTerms": response.choices[0].text.split('\n')[3:]
    } 