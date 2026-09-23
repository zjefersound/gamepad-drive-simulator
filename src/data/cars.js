import data from './cars.json';

/** Lista de carros disponíveis (fonte: cars.json). */
export const CARS = data.cars;

export const getCar = (id) => CARS.find((c) => c.id === id) ?? CARS[0];

/** URL de um arquivo em /public respeitando o base do Vite (GitHub Pages). */
export const assetUrl = (file) => `${import.meta.env.BASE_URL}${file}`;
