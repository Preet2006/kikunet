const PRESET_PHOTOS = Object.freeze({
  indore_station: {
    id: "indore_station",
    label: "Indore station",
    kind: "location",
    visible_details: "The large blue station sign in the photo reads “INDORE JUNCTION.”",
  },
  pune_station: {
    id: "pune_station",
    label: "Different station",
    kind: "location",
    visible_details: "The large blue station sign in the photo reads “PUNE JUNCTION.”",
  },
  paracetamol: {
    id: "paracetamol",
    label: "Paracetamol package",
    kind: "medicine",
    visible_details: "The package in the photo is labelled “PARACETAMOL 500 mg.”",
  },
  ibuprofen: {
    id: "ibuprofen",
    label: "Different medicine",
    kind: "medicine",
    visible_details: "The package in the photo is labelled “IBUPROFEN 200 mg.”",
  },
});

export function getVisionPreset(id) {
  return id && PRESET_PHOTOS[id] ? structuredClone(PRESET_PHOTOS[id]) : null;
}

export function listVisionPresets() {
  return Object.values(PRESET_PHOTOS).map((preset) => structuredClone(preset));
}
