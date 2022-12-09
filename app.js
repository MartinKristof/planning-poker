
const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const sanitizeHtml = require('sanitize-html');


/**
 * List of random names
 */
const playerNames = require('./config/names');

/**
 * Create Express server & Socket.IO
 */
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);

/**
 * Express configuration.
 */
const methodOverride = require('method-override');
const morgan = require('morgan');
const favicon = require('serve-favicon');
const errorhandler = require('errorhandler');
const compression = require('compression');

app.use(compression())
app.use(morgan('combined'));
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(express.json());
app.use(express.urlencoded());
app.use(methodOverride());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '100d' }));

app.set('port', process.env.PORT || 3000);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

const cards = ["0", "½", "1", "2", "3", "5", "8", "13", "20", "40"];
cards.push({ icon: "fa fa-coffee" });
cards.push({ icon: "fa fa-question" });


/**
 * App routes.
 */
app.get('/', (req, res) => {
    res.render('home');
});

app.get('/room/:room', (req, res) => {
    res.render('room', {
        cards,
        room: req.params.room
    });
});

app.get('/history/:room', (req, res) => {
    var room = req.params.room;
    var history = [];
    if (rooms[room]) {
        history = rooms[room].history;
    }
    res.render('history', {
        room,
        history,
    });
});

app.get('/qr/', async (req, res) => {
    try {
        const qrCodeUrl = req.query.url;
        if (req.xhr) {
            const url = await QRCode.toDataURL(qrCodeUrl);
            res.json({ url });
        } else {
            res.header("Content-Type", "image/svg+xml");
            const code = await QRCode.toString(qrCodeUrl, { type: 'svg' });
            res.send(code);
        }
    } catch (err) {
        res.json(err);
    }
});

app.use((req, res) => {
    res.status(404);
    res.render('404');
});

app.use(errorhandler());

/**
 * Start Express server.
 */
server.listen(app.get('port'), function () {
    console.log("✔ Express server listening on port %d in %s mode", app.get('port'), app.settings.env);
});

function generateSfx() {
    return Math.floor(Math.random() * 60) + 1;
}

var clients = {};
var rooms = {};
const CARD_SELECTED = "^";

io.on('connection', (socket) => {
    // We stock socket's id in the people array with "user" as it's name

    clients[socket.id] = { id: socket.id, room: undefined, name: makeClientName() };
    console.log(socket.id + ': Socket connected', clients[socket.id]);

    /**
     * Newly connected client
     */
    socket.on('room', (data) => {
        console.log("Try to join room: ", data);
        var room = getRoom(data);
        if (!room) {
            return socket.disconnect();
        }
        sfxIndex = generateSfx();

        // Join room
        socket.join(room);

        // Set the room of the current client
        clients[socket.id].room = room;

        // Check if room id defined
        if (rooms[room] === undefined) {
            // If not define it and set it's userStory to undefined
            rooms[room] = { name: room, currentUserStory: undefined, cardsRevealed: false, pauseRemaining: false, history: [], sfxIndex };
        }

        // Check if client already has a name
        if (data.name !== undefined) {
            data.name = data.name.trim();
            data.name = sanitizeName(data.name);
            if (data.name != '') {
                clients[socket.id].name = data.name;
            }
        }
        if (data.watch == true || data.watch == 'true') {
            clients[socket.id].watch = true;
        }
        if (rooms[room].cardsRevealed || rooms[room].pauseRemaining) {
            clients[socket.id].watch = true;
        }

        console.log("Joined to room: ", rooms[room], clients[socket.id]);

        // Show for each room who is online in it
        var pInRoom = getPeoplesInRoom(socket, room);

        // Send the current User Story if one is already here
        if (rooms[room].currentUserStory != undefined) {
            socket.emit('newUserStory', rooms[room].currentUserStory);
        }

        // Send the socket_id to newly connected socket
        socket.emit('participants', {
            clients: pInRoom,
            myid: socket.id,
            name: clients[socket.id].name,
            cardsRevealed: rooms[room].cardsRevealed,
            pauseRemaining: rooms[room].pauseRemaining,
            sfxIndex,
        });

        // Broadcast the array in order to list all participants in client
        socket.to(room).emit('participants', {
            clients: pInRoom,
            connect: clients[socket.id].name,
            cardsRevealed: rooms[room].cardsRevealed,
            pauseRemaining: rooms[room].pauseRemaining,
            sfxIndex
        });
    });


    /**
     * Client changes his name
     */
    socket.on('newName', (data) => {
        console.log("New Name:", data);
        var room = getRoom(data);
        if (!room) {
            return socket.disconnect();
        }
        sfxIndex = generateSfx();

        var newName = '';
        try {
            if (data.newName) {
                // Check name (not empty, not full of spaces, no XSS)
                newName = data.newName.trim();
                newName = sanitizeName(newName);
            }
        } catch (e) {
            console.error("Error encoding newName", e);
        }
        if (newName != '') {
            clients[socket.id].name = newName;
            var pInRoom = getPeoplesInRoom(socket, room);
            io.in(room).emit('participants', {
                clients: pInRoom,
                cardsRevealed: rooms[room].cardsRevealed,
                pauseRemaining: rooms[room].pauseRemaining,
                sfxIndex,
            });
        }
    });


    /**
     * Client kick another player (set as watcher)
     */
    socket.on('kickPlayer', (data) => {
        console.log("kickPlayer:", data);
        var room = getRoom(data);
        if (!room) {
            return socket.disconnect();
        }

        try {
            if (data.participant && clients[data.participant]) {
                if (clients[data.participant].card != CARD_SELECTED) {
                    clients[data.participant].watch = true;
                    clients[data.participant].card = undefined;

                    var pInRoom = getPeoplesInRoom(socket, room);
                    io.in(room).emit('participants', {
                        clients: pInRoom,
                        kickedPlayer: clients[data.participant].name,
                        kickedOrigin: clients[socket.id].name,
                        cardsRevealed: rooms[room].cardsRevealed,
                        pauseRemaining: rooms[room].pauseRemaining,
                        sfxIndex
                    });
                }
            }
        } catch (e) {
            console.error("Error kicking player", e);
        }
    });


    /**
     * Client chooses his card
     */
    socket.on('cardSelected', (data) => {
        console.log("cardSelected:", socket.id);
        var room = getRoom(data);
        if (!room || !rooms[room]) {
            return socket.disconnect();
        }

        clientCard = data.card;
        var validCard = false;
        for (const card of cards) {
            if (card.icon) {
                if (clientCard == '<span class="'+card.icon+'" aria-hidden="true"></span>') {
                    validCard = true;
                }
            }
            else if (clientCard == '<b>'+card+'</b>') {
                validCard = true;
            }
        }
        if (!validCard) {
            clientCard = '🤦';
        }

        // Only change card if cards are not revealed yet
        if (rooms[room].cardsRevealed === false) {
            if (data.card) {
                clients[socket.id].card = clientCard;
                clients[socket.id].watch = false;
            }
            if (data.watch !== undefined) {
                clients[socket.id].card = undefined;
                clients[socket.id].watch = data.watch;
            }

            var pInRoom = getPeoplesInRoom(socket, room);
            io.in(room).emit('participants', {
                clients: pInRoom,
                cardsRevealed: rooms[room].cardsRevealed,
                pauseRemaining: rooms[room].pauseRemaining,
                sfxIndex
            });
        }
    });

    /**
     * Client changes User Story
     */
    socket.on('newUserStory', (data) => {
        console.log("newUserStory", data);
        var room = getRoom(data);
        if (!room) {
            return socket.disconnect();
        }

        sfxIndex = generateSfx();
        // If the user story is blank, set it to 'User story'
        if (data.userStory == '') {
            data.userStory = 'User story';
        }
        var newName = data.userStory.trim();
        newName = sanitizeName(newName, 100);

        rooms[room].currentUserStory = newName;
        io.in(room).emit('newUserStory', rooms[room].currentUserStory, sfxIndex);
    });

    /**
    * Reveal cards to all clients
    */
    socket.on('revealCards', (data) => {
        var room = getRoom(data);
        if (!room) {
            return socket.disconnect();
        }

        // Only reveal cards if all players chose their's
        if (checkCards(socket, room) === true) {
            rooms[room].cardsRevealed = true;
            rooms[room].pauseRemaining = 3;
            var pInRoom = getPeoplesInRoom(socket, room);
            console.log("revealCards:", pInRoom);

            rooms[room].history.unshift({ story: rooms[room].currentUserStory, clients: pInRoom, date: new Date() });
            if (rooms[room].history.length > 20) {
                rooms[room].history.pop();
            }
            sendStatusToClients(socket, room );
            // wait for playAgain
            intervalid = setInterval(() => {
                if (rooms[room].pauseRemaining > 0) {
                    rooms[room].pauseRemaining -= 1;
                } else {
                    rooms[room].pauseRemaining = false;
                    clearInterval(intervalid);
                }
                sendStatusToClients(socket, room );
            }, 1000);
        }
    });

    /**
    * Play Again
    */
    socket.on('playAgain', (data) => {
        var room = getRoom(data);
        if (!room) {
            return socket.disconnect();
        }
        if (rooms[room].pauseRemaining > 0) {
            console.error("pauseRemaining is active, cannot play another game")
            return;
        }

        // Only play again if all players chose cards and the cards are revealed
        if (checkCards(socket, room) === true && rooms[room].cardsRevealed === true) {
            var pInRoom = getPeoplesInRoom(socket, room);
            Object.keys(pInRoom).forEach((socket_id) => {
                clients[socket_id].card = undefined;
            });
            pInRoom = getPeoplesInRoom(socket, room);
            rooms[room].cardsRevealed = false;

            io.in(room).emit('participants', {
                clients: pInRoom,
                cardsRevealed: rooms[room].cardsRevealed,
                pauseRemaining: rooms[room].pauseRemaining,
                playAgain: true,
                sfxIndex,
            });
        }
    });

    /**
     * Client disconnects
     */
    // If someones disconnects
    socket.on('disconnect', function () {
        var user = clients[socket.id].name;
        var room = clients[socket.id].room;
        // Delete it's reference in the people array
        delete clients[socket.id];

        var pInRoom = getPeoplesInRoom(socket, room);
        // Then broadcast that someone disconnected, with the remaining participants
        socket.to(room).emit('participants', {
            clients: pInRoom,
            disconnect: user,
            cardsRevealed: rooms[room].cardsRevealed,
            pauseRemaining: rooms[room].pauseRemaining,
            sfxIndex
        });
        console.log(socket.id + ' : Socket disconnected');
    });
});

/**
* Functions
* ________________________
*/
function getPeoplesInRoom(socket, room, anonymize = true) {
    var pInRoom = {};
    var _room = io.sockets.adapter.rooms.get(room);
    if (!_room) {
        return;
    }
    _room.forEach(function (socket_id) {
        pInRoom[socket_id] = JSON.parse(JSON.stringify(clients[socket_id]));

        if ((!rooms[room].cardsRevealed) && pInRoom[socket_id].card) {
            pInRoom[socket_id].card = CARD_SELECTED;
        }
        pInRoom[socket_id] = JSON.stringify(pInRoom[socket_id]);
    });
    return pInRoom;
}

function sendStatusToClients(socket, room) {
    var pInRoom = getPeoplesInRoom(socket, room);
    io.in(room).emit('participants', {
        clients: pInRoom,
        cardsRevealed: rooms[room].cardsRevealed,
        pauseRemaining: rooms[room].pauseRemaining,
        sfxIndex
    });
}

function getRoom(data) {
    var room;
    try {
        room = data.room;
        return room;
    } catch (e) {
        console.error("Error getting room", e);
        return false;
    }
}

function checkCards(socket, room) {
    var i = 0;
    var cards = 0;
    var pInRoom = getPeoplesInRoom(socket, room);
    Object.keys(pInRoom).forEach((socket_id) => {
        if (clients[socket_id].card !== undefined) {
            cards++;
        }
        if (clients[socket_id].watch) {
            cards++;
        }
        i++;
    });
    return (i == cards);
}

function sanitizeName(name, length = 20) {
    name = name.substring(0, length);
    return sanitizeHtml(name, {
        allowedTags: [],
        allowedAttributes: {},
    });
}

function makeClientName() {
    var attemps = 20;
    while (attemps-- > 0) {
        found = false;
        playerName = playerNames.names[Math.floor(Math.random() * playerNames.names.length)].name;
        Object.keys(clients).forEach((socket_id) => {
            if (playerName == clients[socket_id].name) {
                found = true;
            }
        });
        if (found == false) {
            attemps = 0;
            break;
        }
    }
    return playerName;
}
