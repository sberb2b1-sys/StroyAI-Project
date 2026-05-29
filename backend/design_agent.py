import requests
import base64
import sys

API_KEY = "sk-5c8BQfro0ewnhRWpGTU713SSuhGXFMNe42xF5uQSFi9BfyyI"

def generate_design(prompt_text):
    print("📡 Отправка запроса в Stability AI...", file=sys.stderr)
    
    response = requests.post(
        "https://api.stability.ai/v2beta/stable-image/generate/sd3",
        headers={
            "authorization": f"Bearer {API_KEY}",
            "accept": "image/*"
        },
        files={
            "prompt": (None, prompt_text),
            "output_format": (None, "jpeg")
        }
    )
    
    print(f"📊 Статус ответа: {response.status_code}", file=sys.stderr)
    
    if response.status_code == 200:
        print("✅ Успех! Конвертируем в base64...", file=sys.stderr)
        return base64.b64encode(response.content).decode('utf-8')
    else:
        print(f"❌ Ошибка: {response.status_code}", file=sys.stderr)
        print(f"Текст ошибки: {response.text}", file=sys.stderr)
        return None

if __name__ == "__main__":
    prompt = sys.argv[1] if len(sys.argv) > 1 else "modern living room, photorealistic"
    print(f"🎨 Промпт: {prompt}", file=sys.stderr)
    
    image_base64 = generate_design(prompt)
    
    if image_base64:
        print(image_base64)
    else:
        print("ERROR")