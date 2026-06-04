import pytesseract 
from PIL import Image
from pdf2image import convert_from_bytes
import io 

def extract_text_from_file(file_bytes: bytes, filename: str) -> str: 
    """
    Takes raw file bytes and returns extracted text. 
    Handles both images and PDFs.
    
    When we integrate with Umar's service, this whole function gets replaced with a call to run to run_ocr() - everything else stays the same
"""

    filename_lower = filename.lower()
    
    # PDF handling - convert each page to an image, then OCR each page 
    if filename_lower.endswith(".pdf"):
        pages = convert_from_bytes(file_bytes)
        
        extracted_pages = []
        for i, page in enumerate(pages): 
            print(f"[OCR] Processing page {i + 1} of {len(pages)}")
            # Run tesseract on each page image 
            text = pytesseract.image_to_string(page)
            extracted_pages.append(text)
            
            # Hoin all pages with a seperator
            return"n\n\--\n\n".join(extracted_pages)
        
    elif any (filename_lower.endswith(ext) for ext in[".jpg", ".jpeg", ".png", "bmp", ".tiff"]):
        print(f"[OCR] Processing umage: {filename}")

        # Open the bytes as PIL Image 
        image = Image.open(io.BytesIO(file_bytes))
        # tun tesseract on it 
        text = pytesseract.image_to_string(image)
        return text
    
    else: 
        raise ValueError(f"Unsupported file type: {filename}")      
            
    