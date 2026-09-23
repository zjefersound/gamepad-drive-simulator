# 🎮 Gamepad Drive Simulator

Simulador de direção 3D feito com **React + React Three Fiber (three.js)**, pensado para ser jogado com **controle estilo Xbox** e com foco em **dirigibilidade**.

▶️ **Jogar online:** https://zjefersound.github.io/gamepad-drive-simulator/

## Rodando localmente

```bash
npm install
npm run dev
```

Abra o endereço mostrado no terminal, conecte o controle (USB ou Bluetooth) e aperte qualquer botão.

## Controles

| Ação | Controle Xbox | Teclado |
| --- | --- | --- |
| Direção | Analógico esquerdo | ← → / A D |
| Acelerar | RT | ↑ / W |
| Freio / Ré (segure parado) | LT | ↓ / S |
| Freio de mão | A | Espaço |
| Buzina | B | H |
| Nível de assistência | X | T |
| Trocar câmera | Y | C |
| Olhar em volta | Analógico direito | — |
| Marchas (modo manual) | LB / RB | Q / E |
| Câmbio auto / manual | View | M |
| Voltar para a pista | Menu | R |
| Repor cones | D-pad ↓ | K |
| Ocultar ajuda | — | F1 |

Os gatilhos são analógicos, e o controle **vibra** com impactos, patinagem, derrapagem e ao andar na grama.

## Como a dirigibilidade foi construída

A física (`src/game/carPhysics.js`) é própria e roda a **240 Hz** em passo fixo, separada da renderização:

- **Modelo bicicleta de 2 eixos** com curva de pneu **Pacejka** e **círculo de atrito**: acelerar ou frear em curva tira aderência lateral.
- **Transferência de carga**: frear pesa a dianteira e alivia a traseira.
- **Tração dianteira, traseira ou integral** conforme o carro, com câmbio e curva de torque vindos do `cars.json`, freio-motor e embreagem patinando na saída.
- **Limite de esterço dependente da velocidade**: o analógico no talo leva a roda dianteira ao ângulo de deriva de pico do pneu, e não além. Por isso o carro não "sai de frente" quando você vira tudo em alta velocidade.
- **Curva de resposta no analógico** (expoente 1,5) com deadzone reescalada: mais precisão perto do centro.
- **Velocidade de esterço limitada**, com retorno ao centro mais rápido, para suavizar movimentos bruscos do analógico.
- **Assistências** (botão X):
  - *Completa*: controle de tração (TC), controle de estabilidade (ESP) e contra-esterço assistido
  - *Esportiva*: TC e um pouco de contra-esterço, deixa o carro derrapar
  - *Desligada*: tudo manual
- A traseira tem mais aderência e uma queda mais suave depois do pico. Assim a derrapagem é progressiva e controlável.
- Em baixa velocidade, o modelo se mistura com o cinemático, o que deixa as manobras estáveis.

## Som

Todo o som é gerado em tempo real (Web Audio), sem arquivos de áudio:

- **Motor** (`src/game/engineWorklet.js`, AudioWorklet): modelo fisicamente informado, inspirado em [Baldan et al. — *Physically informed car engine sound synthesis*](https://www.researchgate.net/publication/280086598_Physically_informed_car_engine_sound_synthesis_for_virtual_and_augmented_environments):
  - cada combustão gera um pulso de pressão, com variação aleatória entre as explosões;
  - os pulsos ressoam em tubos simulados de coletor e escapamento;
  - o abafador abre com o acelerador;
  - há ronco de admissão e "tic" de válvulas;
  - o corte de giro e o corte na troca de marcha pulam explosões, e ao desacelerar em giro alto aparecem estalos.

  O caráter do motor de cada carro fica em `sound` no `cars.json`: cilindros, comprimento dos tubos, abafador, irregularidade e estalos.
- **Pneus**: uma camada por eixo, com guincho tonal que surge perto do limite de aderência, chiado quando a derrapagem abre, pan estéreo pelo lado da escapada e ruído de rolagem.
- **Grama**, vento e buzina.

## Efeitos de derrapagem

- **Fumaça de pneu** no asfalto e **poeira** na grama: partículas com shader de disco suave, que herdam a velocidade do carro, sobem e se expandem.
- **Marcas de pneu** com opacidade proporcional ao escorregamento e entrada suave. A roda externa da curva marca mais, porque carrega mais peso. Na grama, o pneu deixa sulcos marrons.
- **Tremor de câmera** leve ao derrapar, na grama e em batidas.

## Estrutura

```
src/
  data/        cars.json (carros), cars.schema.json (validação) e helpers
  game/        lógica pura (sem React): física, medições, input, pista, áudio, loop
  components/  cena 3D (carro, mundo, câmera, marcas de pneu, cones) e HUD
scripts/       car-stats.mjs (mede os carros e calcula as notas)
public/models/ modelos 3D (.glb)
```

## Carros (`src/data/cars.json`)

Cada carro é um objeto na lista `cars`. O arquivo tem schema (`cars.schema.json`), então o editor autocompleta e valida os campos.

| Bloco | O que tem |
| --- | --- |
| identificação | `id`, `brand`, `model`, `generation`, `year`, `country`, `bodyStyle`, `description` |
| `specs` | ficha técnica real exibida no jogo: potência, torque, peso, tração, 0–100, velocidade máxima, dimensões |
| `stats`, `class`, `pi`, `measured` | notas de 0 a 10 no estilo jogo de corrida (velocidade, aceleração, dirigibilidade, frenagem, arrancada, fora de estrada), índice de desempenho e classe (D, C, B, A, S1, S2, X) |
| `physics` | parâmetros da simulação: massa, centro de massa, tração (`FWD`, `RWD` ou `AWD`), curva de torque `[rpm, Nm]`, marchas, freios, aerodinâmica e aderência dos pneus |
| `asset` | modelo 3D (`.glb`): arquivo, para onde aponta a frente, nós das rodas, materiais das lanternas e créditos |

### Adicionando um carro

1. Coloque o `.glb` em `public/models/`.
2. Copie o bloco de um carro existente e ajuste `specs`, `physics` e `asset`. O modelo é alinhado automaticamente pelos eixos das rodas indicadas em `asset.wheelNodes`.
3. Rode as medições e grave as notas:

```bash
npm run car-stats -- --write
```

O script roda testes padronizados na própria física do jogo: 0–60, 0–100, velocidade máxima, frenagem 100–0, aderência lateral e arrancada na grama. Os resultados viram as notas, o PI e a classe. Sem `--write`, ele só mostra os números. Aproveite para comparar com a ficha técnica e calibrar a física.

## Créditos

- Modelo 3D **"1999 Volkswagen Gol 2000 GTi (G2)"** por [Ezo](https://sketchfab.com/EzoYEAHH) ([Sketchfab](https://sketchfab.com/3d-models/1999-volkswagen-gol-2000-gti-g2-be772162e96746d0a4470e52dc7fbb1d)), licença [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/). Uso **não comercial**, com atribuição.

## Recursos

- **VW Gol GTI 16V G2 "bola"** (1999) com o modelo 3D acima. Se o arquivo não carregar, entra um Gol bola modelado proceduralmente (`src/components/GolBola.jsx`).
- Circuito fechado com zebras, cronômetro de voltas e minimapa
- Área de treino com slalom, círculo e cones derrubáveis
- Fumaça, poeira, marcas de pneu, rolagem e arfagem da carroceria
- Quatro câmeras: perseguição, perseguição longe, capô e para-choque
- Som procedural de motor, pneus, grama, vento e buzina (veja "Som")
