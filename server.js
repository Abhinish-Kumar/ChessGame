const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);

const port = process.env.PORT || 3000;

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Track waiting players and active games
let waitingPlayers = [];
const activeGames = new Map(); // socket.id -> game data

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Initial chess board setup
const initialBoard = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "N", "R"],
];

// Helper function to deep copy the board
function copyBoard(board) {
  return board.map((row) => [...row]);
}

// Validate a move
function isValidMove(board, from, to, color) {
  const [fromX, fromY] = from;
  const [toX, toY] = to;
  const piece = board[fromX][fromY];

  // Basic validation
  if (!piece) return false;
  if (color === "white" && piece === piece.toLowerCase()) return false;
  if (color === "black" && piece === piece.toUpperCase()) return false;

  // Get opponent color
  const opponentColor = color === "white" ? "black" : "white";

  // Check if destination has own piece
  const destPiece = board[toX][toY];
  if (
    destPiece &&
    ((color === "white" && destPiece === destPiece.toUpperCase()) ||
      (color === "black" && destPiece === destPiece.toLowerCase()))
  ) {
    return false;
  }

  // Piece-specific movement rules
  switch (piece.toLowerCase()) {
    case "p": // Pawn
      const direction = color === "white" ? -1 : 1;
      // Normal move
      if (fromY === toY && !destPiece) {
        // Single step forward
        if (toX === fromX + direction) return true;
        // Double step from starting position
        if (
          (color === "white" && fromX === 6 && toX === 4 && !board[5][fromY]) ||
          (color === "black" && fromX === 1 && toX === 3 && !board[2][fromY])
        ) {
          return true;
        }
      }
      // Capture
      if (
        Math.abs(toY - fromY) === 1 &&
        toX === fromX + direction &&
        destPiece &&
        ((color === "white" && destPiece === destPiece.toLowerCase()) ||
          (color === "black" && destPiece === destPiece.toUpperCase()))
      ) {
        return true;
      }
      break;

    case "r": // Rook
      if (fromX !== toX && fromY !== toY) return false;
      // Check path is clear
      if (fromX === toX) {
        const start = Math.min(fromY, toY) + 1;
        const end = Math.max(fromY, toY);
        for (let y = start; y < end; y++) {
          if (board[fromX][y]) return false;
        }
      } else {
        const start = Math.min(fromX, toX) + 1;
        const end = Math.max(fromX, toX);
        for (let x = start; x < end; x++) {
          if (board[x][fromY]) return false;
        }
      }
      return true;

    case "n": // Knight
      return (
        (Math.abs(fromX - toX) === 2 && Math.abs(fromY - toY) === 1) ||
        (Math.abs(fromX - toX) === 1 && Math.abs(fromY - toY) === 2)
      );

    case "b": // Bishop
      if (Math.abs(fromX - toX) !== Math.abs(fromY - toY)) return false;
      // Check path is clear
      const xDir = toX > fromX ? 1 : -1;
      const yDir = toY > fromY ? 1 : -1;
      let x = fromX + xDir;
      let y = fromY + yDir;
      while (x !== toX && y !== toY) {
        if (board[x][y]) return false;
        x += xDir;
        y += yDir;
      }
      return true;

    case "q": // Queen
      // Rook-like move
      if (fromX === toX || fromY === toY) {
        if (fromX === toX) {
          const start = Math.min(fromY, toY) + 1;
          const end = Math.max(fromY, toY);
          for (let y = start; y < end; y++) {
            if (board[fromX][y]) return false;
          }
        } else {
          const start = Math.min(fromX, toX) + 1;
          const end = Math.max(fromX, toX);
          for (let x = start; x < end; x++) {
            if (board[x][fromY]) return false;
          }
        }
        return true;
      }
      // Bishop-like move
      if (Math.abs(fromX - toX) === Math.abs(fromY - toY)) {
        const xDir = toX > fromX ? 1 : -1;
        const yDir = toY > fromY ? 1 : -1;
        let x = fromX + xDir;
        let y = fromY + yDir;
        while (x !== toX && y !== toY) {
          if (board[x][y]) return false;
          x += xDir;
          y += yDir;
        }
        return true;
      }
      return false;

    case "k": // King
      return Math.abs(fromX - toX) <= 1 && Math.abs(fromY - toY) <= 1;
  }

  return false;
}

// Check if a move puts the king in check
function isInCheck(board, color) {
  // Find the king
  let kingX, kingY;
  const king = color === "white" ? "K" : "k";

  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      if (board[x][y] === king) {
        kingX = x;
        kingY = y;
        break;
      }
    }
    if (kingX !== undefined) break;
  }

  // Check if any opponent piece can attack the king
  const opponentColor = color === "white" ? "black" : "white";

  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      const piece = board[x][y];
      if (
        piece &&
        ((opponentColor === "white" && piece === piece.toUpperCase()) ||
          (opponentColor === "black" && piece === piece.toLowerCase()))
      ) {
        if (isValidMove(board, [x, y], [kingX, kingY], opponentColor)) {
          return true;
        }
      }
    }
  }

  return false;
}

// Check if a move is legal (doesn't leave king in check)
function isLegalMove(board, from, to, color) {
  const newBoard = copyBoard(board);
  const [fromX, fromY] = from;
  const [toX, toY] = to;

  // Make the move on the copied board
  newBoard[toX][toY] = newBoard[fromX][fromY];
  newBoard[fromX][fromY] = "";

  return !isInCheck(newBoard, color);
}

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on("readyToPlay", () => {
    console.log(`Player ${socket.id} is ready to play`);

    // If there's a waiting player, match them
    if (waitingPlayers.length > 0) {
      const opponent = waitingPlayers.shift();
      startNewGame(socket, opponent);
    } else {
      waitingPlayers.push(socket);
      socket.emit("status", "Waiting for an opponent...");
    }
  });

  socket.on("makeMove", ({ from, to }) => {
    const game = activeGames.get(socket.id);
    if (!game) return;

    const [fromX, fromY] = from;
    const [toX, toY] = to;
    const piece = game.board[fromX][fromY];

    // Validate the move
    if (!piece) {
      socket.emit("invalidMove", "No piece at starting position");
      return;
    }

    // Check if it's the player's turn
    const playerColor = game.players.white === socket.id ? "white" : "black";
    if (
      (playerColor === "white" && game.turn !== "white") ||
      (playerColor === "black" && game.turn !== "black")
    ) {
      socket.emit("invalidMove", "Not your turn");
      return;
    }

    // Validate the move rules
    if (!isValidMove(game.board, from, to, playerColor)) {
      socket.emit("invalidMove", "Invalid move for this piece");
      return;
    }

    // Check if move leaves king in check
    if (!isLegalMove(game.board, from, to, playerColor)) {
      socket.emit("invalidMove", "Move would leave king in check");
      return;
    }

    // Make the move
    game.board[toX][toY] = game.board[fromX][fromY];
    game.board[fromX][fromY] = "";

    // Switch turns
    game.turn = game.turn === "white" ? "black" : "white";

    // Check for check/checkmate
    const opponentColor = playerColor === "white" ? "black" : "white";
    const inCheck = isInCheck(game.board, opponentColor);

    // Check for checkmate (if opponent has no legal moves)
    let isCheckmate = false;
    if (inCheck) {
      isCheckmate = true;
      // Check if opponent has any legal moves
      for (let x = 0; x < 8 && isCheckmate; x++) {
        for (let y = 0; y < 8 && isCheckmate; y++) {
          const piece = game.board[x][y];
          if (
            piece &&
            ((opponentColor === "white" && piece === piece.toUpperCase()) ||
              (opponentColor === "black" && piece === piece.toLowerCase()))
          ) {
            // Check all possible moves for this piece
            for (let tx = 0; tx < 8 && isCheckmate; tx++) {
              for (let ty = 0; ty < 8 && isCheckmate; ty++) {
                if (
                  isValidMove(game.board, [x, y], [tx, ty], opponentColor) &&
                  isLegalMove(game.board, [x, y], [tx, ty], opponentColor)
                ) {
                  isCheckmate = false;
                }
              }
            }
          }
        }
      }
    }

    // Check for stalemate (if opponent has no legal moves and not in check)
    let isStalemate = false;
    if (!inCheck) {
      isStalemate = true;
      for (let x = 0; x < 8 && isStalemate; x++) {
        for (let y = 0; y < 8 && isStalemate; y++) {
          const piece = game.board[x][y];
          if (
            piece &&
            ((opponentColor === "white" && piece === piece.toUpperCase()) ||
              (opponentColor === "black" && piece === piece.toLowerCase()))
          ) {
            // Check all possible moves for this piece
            for (let tx = 0; tx < 8 && isStalemate; tx++) {
              for (let ty = 0; ty < 8 && isStalemate; ty++) {
                if (
                  isValidMove(game.board, [x, y], [tx, ty], opponentColor) &&
                  isLegalMove(game.board, [x, y], [tx, ty], opponentColor)
                ) {
                  isStalemate = false;
                }
              }
            }
          }
        }
      }
    }

    // Prepare move data
    const moveData = {
      from: from,
      to: to,
      piece: piece,
      board: copyBoard(game.board),
      turn: game.turn,
      inCheck: inCheck,
      isCheckmate: isCheckmate,
      isStalemate: isStalemate,
    };

    // Notify both players
    io.to(game.players.white).emit("moveMade", moveData);
    io.to(game.players.black).emit("moveMade", moveData);

    // Handle game over conditions
    if (isCheckmate || isStalemate) {
      let resultMessage;
      if (isCheckmate) {
        resultMessage = `Checkmate! ${playerColor} wins!`;
      } else {
        resultMessage = "Stalemate! Game is a draw.";
      }

      io.to(game.players.white).emit("gameOver", resultMessage);
      io.to(game.players.black).emit("gameOver", resultMessage);

      // Clean up game
      activeGames.delete(game.players.white);
      activeGames.delete(game.players.black);
    }
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);

    // Remove from waiting list if present
    waitingPlayers = waitingPlayers.filter((player) => player.id !== socket.id);

    // Handle if player was in active game
    const game = activeGames.get(socket.id);
    if (game) {
      const opponentId =
        game.players.white === socket.id
          ? game.players.black
          : game.players.white;

      // Notify opponent
      io.to(opponentId).emit(
        "opponentDisconnected",
        "Your opponent has disconnected"
      );

      // Clean up game
      activeGames.delete(game.players.white);
      activeGames.delete(game.players.black);
    }
  });
});

function startNewGame(player1, player2) {
  // Randomly assign colors
  const whitePlayer = Math.random() < 0.5 ? player1 : player2;
  const blackPlayer = whitePlayer === player1 ? player2 : player1;

  const gameData = {
    board: copyBoard(initialBoard),
    turn: "white",
    players: {
      white: whitePlayer.id,
      black: blackPlayer.id,
    },
  };

  // Store game for both players
  activeGames.set(whitePlayer.id, gameData);
  activeGames.set(blackPlayer.id, gameData);

  // Notify players
  whitePlayer.emit("gameStart", {
    color: "white",
    opponent: blackPlayer.id,
    board: copyBoard(initialBoard),
    turn: "white",
  });

  blackPlayer.emit("gameStart", {
    color: "black",
    opponent: whitePlayer.id,
    board: copyBoard(initialBoard),
    turn: "white",
  });

  console.log(
    `New game started between ${whitePlayer.id} (white) and ${blackPlayer.id} (black)`
  );
}

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
