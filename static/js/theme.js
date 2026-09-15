function getTheme() {
    return localStorage.getItem('theme') || 'light';
}

function saveTheme(theme) {
    localStorage.setItem('theme', theme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

function detectSystemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    return 'light';
}

if (!localStorage.getItem('theme')) {
    saveTheme(detectSystemTheme());
}

// Applied immediately (this script is loaded in <head>) so the dark theme doesn't flash light first
applyTheme(getTheme());
