/**
 * Color Utilities
 * Functions for color manipulation and conversion.
 */

/**
 * Converts hex color to RGB string "r, g, b"
 * @param {string} hex - Hex color string (with or without #)
 * @returns {string} RGB string format "r, g, b"
 */
export function hexToRgb(hex) {
    // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
        : '255, 255, 255'; // Default to white on error
}

/**
 * Converts hex color to RGB object
 * @param {string} hex - Hex color string
 * @returns {{r: number, g: number, b: number}} RGB object
 */
export function hexToRgbObject(hex) {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 255, g: 255, b: 255 };
}

/**
 * Gets a complementary color (simple inversion)
 * @param {string} hex - Hex color string
 * @returns {string} Complementary hex color
 */
export function getComplementaryColor(hex) {
    try {
        if (hex.startsWith('#')) hex = hex.slice(1);
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const rComp = (255 - r).toString(16).padStart(2, '0');
        const gComp = (255 - g).toString(16).padStart(2, '0');
        const bComp = (255 - b).toString(16).padStart(2, '0');
        return `#${rComp}${gComp}${bComp}`;
    } catch (e) {
        return "#FFFFFF"; // Default on error
    }
}

/**
 * Creates an RGBA color string
 * @param {string} hex - Hex color
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} RGBA string
 */
export function hexToRgba(hex, alpha) {
    return `rgba(${hexToRgb(hex)}, ${alpha})`;
}

/**
 * Creates a random HSL color
 * @param {number} saturation - Saturation percentage (0-100)
 * @param {number} lightness - Lightness percentage (0-100)
 * @returns {string} HSL color string
 */
export function randomHslColor(saturation = 100, lightness = 60) {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
