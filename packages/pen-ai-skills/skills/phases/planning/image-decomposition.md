---
name: image-decomposition
description: Decompose reference images into spatial regions for faithful reproduction instead of web sections
phase: [planning]
trigger:
  keywords: [reproduce, copy, replicate, trace, match, same, exact, faithful, 그대로, 따라, 복사, 재현, 모방]
priority: 50
budget: 1500
category: base
---

IMAGE REPRODUCTION DECOMPOSITION:

When the user provides a reference image to reproduce (NOT to convert into a web page), decompose it into spatial regions based on what is VISUALLY PRESENT in the image.

DETECTION:
If the user says any of these, activate image reproduction mode:
- "이거 그대로 그려줘" / "이거 따라 그려" / "이 이미지 재현해줘"
- "reproduce this" / "copy this design" / "make it look exactly like this"
- "replicate" / "match this" / "same as this"
- Provides an image with no other instruction or says "draw this"

DECOMPOSITION RULES:

1. Analyze the image visually — identify distinct visual regions by spatial grouping, NOT by web conventions.
2. Each subtask = a visual region or element cluster in the image.
3. Set rootFrame dimensions to match the image's aspect ratio and approximate size.
4. Do NOT default to width=1200 or 375 — use dimensions that match the reference image proportions.
5. Do NOT label subtasks as "Hero", "Navigation", "Footer" etc. unless those elements are clearly identifiable in the image. Use descriptive labels like "Top text group", "Center illustration", "Bottom badge row".

FORMAT:
Same JSON format as standard decomposition, but with image-appropriate regions.

EXAMPLE:
For a poster with a title at top, illustration in center, and text at bottom:
{"rootFrame":{"id":"page","name":"Poster","width":800,"height":1100,"layout":"vertical","gap":24,"fill":[{"type":"solid","color":"#FFFFFF"}]},"styleGuideName":"none","subtasks":[{"id":"title-area","label":"Title and subtitle text","elements":"main title text, subtitle text","region":{"width":800,"height":200}},{"id":"illustration","label":"Center illustration","elements":"main illustration with character and background elements","region":{"width":800,"height":600}},{"id":"bottom-info","label":"Bottom information","elements":"date text, location text, logo badge","region":{"width":800,"height":200}}]}
