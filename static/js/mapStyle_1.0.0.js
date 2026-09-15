// Map style shared by pages that use MapLibre with the Cyprus PMTiles (copy of BusRoutesApp.getMapStyle)
function getMapStyle() {
    const isDark = getTheme() === 'dark';
    if (isDark){
        return {
            version: 8,
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
            sources: {
                example_source: {
                    type: "vector",
                    url: "pmtiles://https://tixan.netlify.app/cyprus.pmtiles"
                }
            },
            layers: [
                {
                    id: "background",
                    type: "background",
                    paint: {"background-color": "#1b2a3f"}
                },
                {
                    id: "water",
                    source: "example_source",
                    "source-layer": "water",
                    type: "fill",
                    paint: {"fill-color": "#01102f"}
                },
                {
                    id: "landcover",
                    source: "example_source",
                    "source-layer": "landcover",
                    type: "fill",
                    paint: {"fill-color": "#155463"}
                },
                {
                    id: "landuse",
                    source: "example_source",
                    "source-layer": "landuse",
                    type: "fill",
                    paint: {"fill-color": "#1b2a3f"}
                },
                {
                    id: "park",
                    source: "example_source",
                    "source-layer": "park",
                    type: "fill",
                    paint: {"fill-color": "#155463"}
                },
                {
                    id: "major-roads",
                    source: "example_source",
                    "source-layer": "transportation",
                    type: "line",
                    filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "primary_link", "secondary_link"],
                    paint: {
                        "line-color": "#466788",
                        "line-width": [
                            "interpolate", ["linear"], ["zoom"],
                            8, 1.5, 14, 4, 17, 10
                        ]
                    }
                },
                {
                    id: "minor-roads",
                    source: "example_source",
                    "source-layer": "transportation",
                    type: "line",
                    minzoom: 11,
                    filter: ["in", "class", "tertiary", "residential", "living_street", "service", "unclassified", "track", "path", "pedestrian", "road"],
                    paint: {
                        "line-color": "#3d4f67",
                        "line-width": [
                            "interpolate", ["linear"], ["zoom"],
                            8, 0.3, 14, 1.5, 17, 3
                        ]
                    }
                },
                {
                    id: "building",
                    source: "example_source",
                    "source-layer": "building",
                    type: "fill",
                    paint: {
                        "fill-color": "#263646",
                        "fill-outline-color": "#32475c"
                    }
                },
                {
                    id: "place-labels",
                    source: "example_source",
                    "source-layer": "place",
                    type: "symbol",
                    minzoom: 11,
                    layout: {
                        "text-field": ["get", "name"],
                        "text-font": ["Noto Sans Regular"],
                        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 12, 14, 18],
                        "text-anchor": "center"
                    },
                    paint: {
                        "text-color": "#cfdfee",
                        "text-halo-color": "#000",
                        "text-halo-width": 1.5,
                        "text-opacity": [
                            "interpolate",
                            ["linear"],
                            ["zoom"],
                            12, 1,
                            12.8, 0
                        ]
                    }
                },
                {
                    id: "ocean",
                    source: "example_source",
                    "source-layer": "water",
                    type: "fill",
                    filter: ["==", "class", "ocean"],
                    paint: {
                        "fill-color": "#003366"
                    }
                },
                {
                    id: "sand",
                    source: "example_source",
                    "source-layer": "landcover",
                    type: "fill",
                    filter: ["==", "class", "beach"],
                    paint: {
                        "fill-color": "#e4d8a7"
                    }
                },
                {
                    id: "parks",
                    source: "example_source",
                    "source-layer": "landuse",
                    type: "fill",
                    filter: ["in", "class", "park", "recreation_ground", "garden", "grass"],
                    paint: {
                        "fill-color": "#155463",
                        "fill-opacity": 0.6
                    }
                },
                {
                    id: "natural-areas",
                    source: "example_source",
                    "source-layer": "landcover",
                    type: "fill",
                    filter: ["in", "class", "forest", "grassland", "scrub"],
                    paint: {
                        "fill-color": "#155463",
                        "fill-opacity": 0.5
                    }
                },
                {
                    id: "street-labels",
                    source: "example_source",
                    "source-layer": "transportation_name",
                    type: "symbol",
                    minzoom: 12.6,
                    layout: {
                        "text-field": ["get", "name"],
                        "text-font": ["Noto Sans Regular"],
                        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 16, 17, 16],
                        "symbol-placement": "line",
                        "text-rotation-alignment": "map"
                    },
                    paint: {
                        "text-color": "#bbbbbb",
                        "text-halo-color": "#000000",
                        "text-halo-width": 1
                    }
                },
                {
                    id: "town-labels",
                    source: "example_source",
                    "source-layer": "place",
                    type: "symbol",
                    filter: ["in", "class", "city"],
                    layout: {
                        "text-field": ["get", "name"],
                        "text-font": ["Noto Sans Regular"],
                        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 16, 14, 40],
                        "text-anchor": "center",
                        "text-offset": [0, 0]
                    },
                    paint: {
                        "text-color": "#ffffff",
                        "text-halo-color": "#000000",
                        "text-halo-width": 2,
                        "text-opacity": [
                            "interpolate",
                            ["linear"],
                            ["zoom"],
                            12, 1,
                            12.6, 0
                        ]
                    }
                }

            ]
        };
    } else {
        return {
            version: 8,
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
            sources: {
                example_source: {
                    type: "vector",
                    url: "pmtiles://https://tixan.netlify.app/cyprus.pmtiles"
                }
            },
            layers: [
                {
                    id: "background",
                    type: "background",
                    paint: {"background-color": "#f7f7f7"}
                },
                {
                    id: "water",
                    source: "example_source",
                    "source-layer": "water",
                    type: "fill",
                    paint: {"fill-color": "#8fdaed"}
                },
                {
                    id: "landcover",
                    source: "example_source",
                    "source-layer": "landcover",
                    type: "fill",
                    paint: {"fill-color": "#a9eac2"}
                },
                {
                    id: "landuse",
                    source: "example_source",
                    "source-layer": "landuse",
                    type: "fill",
                    paint: {"fill-color": "#f7f7f7"}
                },
                {
                    id: "park",
                    source: "example_source",
                    "source-layer": "park",
                    type: "fill",
                    paint: {"fill-color": "#a9eac2"}
                },
                {
                    id: "major-roads",
                    source: "example_source",
                    "source-layer": "transportation",
                    type: "line",
                    filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "primary_link", "secondary_link"],
                    paint: {
                        "line-color": "#ABBCD6",
                        "line-width": [
                            "interpolate", ["linear"], ["zoom"],
                            8, 1.5, 14, 4, 17, 10
                        ]
                    }
                },
                {
                    id: "minor-roads",
                    source: "example_source",
                    "source-layer": "transportation",
                    type: "line",
                    minzoom: 11,
                    filter: ["in", "class", "tertiary", "residential", "living_street", "service", "unclassified", "track", "path", "pedestrian", "road"],
                    paint: {
                        "line-color": "#CDD7E0",
                        "line-width": [
                            "interpolate", ["linear"], ["zoom"],
                            8, 0.3, 14, 1.5, 17, 3
                        ]
                    }
                },
                {
                    id: "building",
                    source: "example_source",
                    "source-layer": "building",
                    type: "fill",
                    paint: {
                        "fill-color": "#E8E9Ed",
                        "fill-outline-color": "#dcdde1"
                    }
                },
                {
                    id: "place-labels",
                    source: "example_source",
                    "source-layer": "place",
                    type: "symbol",
                    minzoom: 11,
                    layout: {
                        "text-field": ["get", "name"],
                        "text-font": ["Noto Sans Regular"],
                        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 12, 14, 18],
                        "text-anchor": "center"
                    },
                    paint: {
                        "text-color": "#2f3034",
                        "text-halo-color": "#ffffff",
                        "text-halo-width": 1.5,
                        "text-opacity": [
                            "interpolate",
                            ["linear"],
                            ["zoom"],
                            12, 1,
                            12.8, 0
                        ]
                    }
                },
                {
                    id: "ocean",
                    source: "example_source",
                    "source-layer": "water",
                    type: "fill",
                    filter: ["==", "class", "ocean"],
                    paint: {
                        "fill-color": "#8fdaed"
                    }
                },
                {
                    id: "sand",
                    source: "example_source",
                    "source-layer": "landcover",
                    type: "fill",
                    filter: ["==", "class", "beach"],
                    paint: {
                        "fill-color": "#e4d8a7"
                    }
                },
                {
                    id: "parks",
                    source: "example_source",
                    "source-layer": "landuse",
                    type: "fill",
                    filter: ["in", "class", "park", "recreation_ground", "garden", "grass"],
                    paint: {
                        "fill-color": "#a9eac2",
                        "fill-opacity": 0.6
                    }
                },
                {
                    id: "natural-areas",
                    source: "example_source",
                    "source-layer": "landcover",
                    type: "fill",
                    filter: ["in", "class", "forest", "grassland", "scrub"],
                    paint: {
                        "fill-color": "#a9eac2",
                        "fill-opacity": 0.5
                    }
                },
                {
                    id: "street-labels",
                    source: "example_source",
                    "source-layer": "transportation_name",
                    type: "symbol",
                    minzoom: 12.6,
                    layout: {
                        "text-field": ["get", "name"],
                        "text-font": ["Noto Sans Regular"],
                        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 16, 17, 16],
                        "symbol-placement": "line",
                        "text-rotation-alignment": "map"
                    },
                    paint: {
                        "text-color": "#505E6B",
                        "text-halo-color": "#ffffff",
                        "text-halo-width": 1
                    }
                },
                {
                    id: "town-labels",
                    source: "example_source",
                    "source-layer": "place",
                    type: "symbol",
                    filter: ["in", "class", "city"],
                    layout: {
                        "text-field": ["get", "name"],
                        "text-font": ["Noto Sans Regular"],
                        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 16, 14, 40],
                        "text-anchor": "center",
                        "text-offset": [0, 0]
                    },
                    paint: {
                        "text-color": "#2f3034",
                        "text-halo-color": "#ffffff",
                        "text-halo-width": 2,
                        "text-opacity": [
                            "interpolate",
                            ["linear"],
                            ["zoom"],
                            12, 1,
                            12.6, 0
                        ]
                    }
                }

            ]
        };
    }
}
