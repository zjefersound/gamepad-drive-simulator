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
- **Tração traseira**, 6 marchas + ré, curva de torque, freio-motor e embreagem patinando na saída.
- **Limite de esterço dependente da velocidade**: o analógico no talo leva a roda dianteira ao ângulo de deriva de pico do pneu, e não além. Por isso o carro não "sai de frente" quando você vira tudo em alta velocidade.
- **Curva de resposta no analógico** (expoente 1,5) com deadzone reescalada: mais precisão perto do centro.
- **Velocidade de esterço limitada**, com retorno ao centro mais rápido, para suavizar movimentos bruscos do analógico.
- **Assistências** (botão X):
  - *Completa*: controle de tração (TC), controle de estabilidade (ESP) e contra-esterço assistido
  - *Esportiva*: TC e um pouco de contra-esterço, deixa o carro derrapar
  - *Desligada*: tudo manual
- A traseira tem mais aderência e uma queda mais suave depois do pico. Assim a derrapagem é progressiva e controlável.
- Em baixa velocidade, o modelo se mistura com o cinemático, o que deixa as manobras estáveis.

## Estrutura

```
src/
  game/        lógica pura (sem React): física, input, pista, áudio, loop
  components/  cena 3D (carro, mundo, câmera, marcas de pneu, cones) e HUD
```

## Recursos

- **VW Gol G2 "bola"** (1995–1999) modelado proceduralmente em three.js (`src/components/GolBola.jsx`): o perfil lateral é extrudado com bordas bem arredondadas. A física usa as medidas do carro real: entre-eixos de 2,47 m, bitola de 1,40 m e pneus aro 13.
- Circuito fechado com zebras, cronômetro de voltas e minimapa
- Área de treino com slalom, círculo e cones derrubáveis
- Marcas de pneu, rolagem e arfagem da carroceria
- Quatro câmeras: perseguição, perseguição longe, capô e para-choque
- Som procedural de motor, pneus, vento e buzina (Web Audio, sem arquivos externos)
