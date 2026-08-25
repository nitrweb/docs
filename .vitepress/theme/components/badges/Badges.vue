<script setup lang="ts"></script>

<template>
    <div class="badges">
        <a href="https://github.com/joseluisq/nitr/actions/workflows/devel.yml" title="devel ci">
            <img src="https://github.com/joseluisq/nitr/actions/workflows/devel.yml/badge.svg" alt="devel ci" />
        </a>
        <a href="https://app.codspeed.io/joseluisq/nitr" title="CodSpeed benchmarks">
            <img src="https://img.shields.io/endpoint?url=https://codspeed.io/badge.json" alt="CodSpeed" />
        </a>
        <a href="https://github.com/joseluisq/nitr/blob/master/LICENSE-APACHE" title="Nitr license">
            <img src="https://img.shields.io/badge/license-MIT%20%2F%20Apache--2.0-blue" alt="license" />
        </a>
        <a href="https://github.com/joseluisq/nitr/stargazers" title="GitHub stars">
            <img src="https://img.shields.io/github/stars/joseluisq/nitr?style=flat&logo=github" alt="stars" />
        </a>
    </div>
</template>

<style scoped>
.badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 2rem;
    justify-content: center;
}

.badges a {
    display: inline-block;
}

.badges img {
    margin: 0;
}
</style>
