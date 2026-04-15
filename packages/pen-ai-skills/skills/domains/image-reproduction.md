---
name: image-reproduction
description: Faithful visual reproduction of reference images as vector designs instead of converting to web components
phase: [generation]
trigger:
  keywords: [reproduce, copy, replicate, trace, match, same, exact, faithful, 그대로, 따라, 복사, 재현, 모방]
priority: 50
budget: 2000
category: domain
---

IMAGE FAITHFUL REPRODUCTION MODE:

When the user provides a reference image and wants it reproduced (not converted to a web page), follow these rules:

PURPOSE:
You are reproducing the visual appearance of the reference image as faithfully as possible using PenNode primitives. You are NOT converting it into web UI components.

CRITICAL RULES:

1. DO NOT interpret the image as a web page design. DO NOT add navigation bars, hero sections, CTAs, or footers unless they are visible in the reference image.
2. Reproduce the ACTUAL visual elements seen in the image: shapes, text, colors, spatial relationships, proportions.
3. Use the image's actual dimensions and aspect ratio for the root frame.
4. Match colors exactly from the reference image.
5. Preserve spatial layout — position elements where they appear in the reference, not in a web-standard grid.

ELEMENT MAPPING:

- Solid color areas → rectangle or frame with fill
- Text → text node with matching font size, weight, color
- Icons/symbols → path node with appropriate SVG path
- Circular elements → ellipse
- Photos/complex imagery → image node with imageSearchQuery describing the content
- Grouped elements → frame with children

LAYOUT APPROACH:

- Use layout="none" with explicit x/y positioning when the design is freeform (not grid-based)
- Use layout="vertical" or "horizontal" only when elements are clearly arranged in rows/columns
- Preserve whitespace and spacing as seen in the reference
- Do NOT force elements into standard web layout patterns

WHAT NOT TO DO:

- Do NOT add elements that are not in the reference image
- Do NOT restructure the layout into web conventions (header-main-footer)
- Do NOT add hover states, CTAs, or interactive patterns
- Do NOT assume the image is a wireframe that needs to be "completed"
- Do NOT change the color scheme to match a style guide — use the actual colors from the image
