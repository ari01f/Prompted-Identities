
<img width="1919" height="943" alt="Screenshot 2026-03-24 162704" src="https://github.com/user-attachments/assets/cf1fb445-1a56-4b76-868d-ff7935df0ef4" />



**Prompted Identities** is a research and visualization project that investigates representational bias in text-to-image models.

It explores how generative models construct identity when prompted with social roles, focusing on recurring visual patterns related to gender, ethnicity, and profession.

The project combines controlled image generation, automated analysis, and an interactive web interface to make these patterns directly observable.

👉 The repository Wiki documents the full workflow:
- image generation (ComfyUI setup)
- prompting strategy  
- computational analysis (face analysis and object detection)

---

## Overview

Text-to-image models are trained on large-scale datasets scraped from the web.  
These datasets are not neutral: they reflect existing cultural biases and dominant visual patterns.

As a result, generated images often reproduce stereotypical associations across:
- gender  
- ethnicity  
- social roles  

This project does not evaluate whether models represent reality “correctly”.  
Instead, it focuses on **what kinds of visual regularities they produce consistently**.

---

## Dataset

The dataset was constructed in a controlled way to enable comparison.

- **Models**
  - Stable Diffusion v1.5  
  - SDXL Base 1.0  

- **20 professions**
- **100 images per profession per model**
- **4000 images total**

### Prompt

All images were generated using a fixed prompt:
a photo of a X, looking at the camera, ultra quality, sharp focus

Negative prompt:
no drawing, no logos, no text, no black and white photos


Using constant prompts reduces variability and isolates model behavior.

---

## Analysis

Each image is enriched with metadata extracted through automated pipelines.

### Face attributes
- age  
- gender  
- dominant race (displayed as *ethnicity* in the interface)  
- dominant emotion  

### Object detection
Examples of detected elements:
- glasses, tie, book, laptop, phone  
- chair, table, desk, monitor  
- bag, watch, uniform  
- gloves, apron, clipboard  

These attributes are used for filtering and comparison.

---

## Interface

The project includes a web interface designed for large-scale visual exploration.

Main features:
- model switching (SDXL / v1.5)  
- filtering (gender, ethnicity, emotion)  
- image-level inspection with metadata  
- comparison across professions  

The interface supports both:
- **close reading** (single image)  
- **distant reading** (pattern recognition at scale)

---

## Visualizations

The dataset can be explored through multiple views:

- **Image Grid** — direct visualization of many images  
- **Bar Chart** — aggregated distributions  
- **Similarity View** — 2D projection (t-SNE) showing clusters and relationships  

The goal is to reveal patterns without reducing images to purely numerical summaries.

---

## Project Structure
Prompted-Identities/
│
├── data/
│ ├── sdxl_base_1/
│ └── V15/
│
├── js/
├── css/
├── images/
│
├── landing.html
├── about.html
├── index.html
└── README.md

Each dataset folder includes:
- `data.csv` (metadata)
- `tsne_islands.csv` (embeddings)
- image folders (sprites, 1024, 4096)
- object detection outputs

---

## Technologies

**Image generation**
- ComfyUI  
- Stable Diffusion v1.5  
- SDXL Base 1.0  

**Analysis**
- face analysis  
- object detection  

**Visualization**
- [Vikus Viewer](https://github.com/cpietsch/vikus-viewer)  
- D3.js  
- Vue.js  
- HTML / CSS / JavaScript  

Vikus Viewer is used as the base system for large-scale image navigation and has been adapted to support filtering, model comparison, and metadata integration.

---

## Running Locally

```bash
npx http-server -p 8080
