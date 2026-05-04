function getTheme() {
    return localStorage.getItem('theme') || 'light';
}

function saveTheme(theme) {
    localStorage.setItem('theme', theme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

document.addEventListener('DOMContentLoaded', function () {
    applyTheme(getTheme());
});

function detectSystemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    return 'light';
}

if (!localStorage.getItem('theme')) {
    const systemTheme = detectSystemTheme();
    applyTheme(systemTheme);
    saveTheme(systemTheme);
}
