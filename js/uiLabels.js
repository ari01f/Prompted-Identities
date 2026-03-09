/**
 * Central UI label mapping layer.
 *
 * Edit the objects below to rename any view mode, filter category,
 * or filter option value in the UI without touching the data files
 * or the filtering logic.
 *
 * If a key is not listed here the original string is shown as-is.
 */

var uiLabels = {

  /* ── View-mode / navigation labels ─────────────────────────── */
  views: {
    "Professions":  "Bar chart",
    "Image grid":   "Image grid",
    "UMAP":         "Similarity"
  },

  /* ── Filter category headers ───────────────────────────────── */
  filters: {
    "gender":  "Gender",
    "race":    "Ethnicity",
    "emotion": "Emotion"
  },

  /* ── Individual option values inside filters ───────────────── */
  values: {
    "woman":           "Woman",
    "man":             "Man",
    "black":           "Black",
    "white":           "White",
    "asian":           "Asian",
    "indian":          "Indian",
    "latino_hispanic": "Hispanic",
    "middle_eastern":  "West Asian",
    "happy":           "Happy",
    "neutral":         "Neutral",
    "sad":             "Sad",
    "angry":           "Angry",
    "fear":            "Fear",
    "surprise":        "Surprise",
    "disgust":         "Disgust"
  }
};

/**
 * Helper – look up a display label with safe fallback.
 * @param {"views"|"filters"|"values"} scope
 * @param {string} key   original internal key
 * @returns {string}      mapped label or the original key
 */
function uiLabel(scope, key) {
  return (uiLabels[scope] && uiLabels[scope][key]) || key;
}
