var room = $("#room").attr("data-room");
var baseUrl = window.location.protocol + "//" + window.location.host + "/";

var ui = {
    cardsButtonDisabled: false,
    cardsRevealed: false,
    pauseRemaining: false,
};
var participants = {
    players: 0,
    watcher: 0,
};
var player = {
    name: undefined,
    id: undefined,
    watch: false,
    card: undefined
};
var sfxIndex = null;
var isSfxPlaying = false;


$(document).ready(function () {
    $('#shareLink').removeClass("disabled");
    $('#historyLink').removeClass("disabled");
    $('#watchOnly').removeClass("disabled");

    /**
     * Socket.IO
     */
    var socket = io.connect(baseUrl);

    socket.on("connect", function (data) {
        player.name = undefined;
        player.id = undefined;
        player.card = undefined;

        // Check local storage if settings is already set
        if (localStorage.getItem("watch")) {
            player.watch = (localStorage.getItem("watch") == "true");
            updateWatchChb();
        }
        if (localStorage.getItem("name") != undefined) {
            player.name = localStorage.getItem("name");
        }
        socket.emit("room", { room: room, name: player.name, watch: player.watch });
    });

    /**
     * Participants
     */
    // Everytime a new person joins or leave, update the participant's list
    socket.on("participants", function (data) {
        // We keep client's id to recognize him
        if (data.myid !== undefined) {
            player.id = data.myid;
            player.name = data.name;
        }
        // Send a alert for a connection
        if (data.connect !== undefined) {
            newAlert("success", "info", data.connect + " just joined");
        }

        // Kick player
        if (data.kickedPlayer !== undefined) {
            newAlert("danger", "info", data.kickedOrigin + " just kicked " + data.kickedPlayer);
        }

        if (data.playAgain !== undefined) {
            newAlert("info", "info", "New game started");
        }

        // Send a alert for a disconnection
        if (data.disconnect !== undefined) {
            newAlert("danger", "info", data.disconnect + " just left");
        }

        if (data.cardsRevealed !== undefined) {
            ui.cardsRevealed = data.cardsRevealed;
        }
        if (data.pauseRemaining !== undefined) {
            ui.pauseRemaining = data.pauseRemaining;
        }

        sfxIndex = data.sfxIndex;
        updateParticipants(data.clients);
        displayCards(data.clients);
    });

    /**
     * Update User Story
     */
    socket.on("newUserStory", function (userStory, newSfxIndex) {
        $("#userStory").html(userStory);
        newAlert("warning", "info", "User story changed to " + userStory);
        isSfxPlaying = false;
        sfxIndex = newSfxIndex;
    });

    /**
     * Play Again
     */
    socket.on("playAgain", function (clients) {
        newAlert("info", "info", "New game started");
    });

    /**
     * Main
     */
    $("#copyLink").click(function (e) {
        if (navigator.share) {
            navigator.share({
                title: document.title,
                text: "Planning Poker",
                url: window.location.href
            }).then(
                () => console.debug("Successful share")
            ).catch(
                (error) => console.log("Error sharing:", error)
            );
        } else {
            var $temp = $("<input>");
            $("body").append($temp);
            $temp.val(window.location.href).select();
            document.execCommand("copy");
            $temp.remove();
            newAlert("success", "info", "Link copied to clipboard");
        }
        e.preventDefault();
    });


    /**
     * Change username & kick player
     */
    var chNameModal = document.getElementById('chNameModal');
    var kickPlayerModal = document.getElementById('kickPlayerModal');
    var chUserStoryModal = document.getElementById('chUserStoryModal');

    $("#chUserStoryModal").submit(function (e) {
        var modalBodyInput = chUserStoryModal.querySelector('.modal-body input');
        // Get the new name
        var userStory = modalBodyInput.value;
        socket.emit("newUserStory", { room: room, userStory: userStory });

        e.preventDefault();
        bsModal = bootstrap.Modal.getInstance(chUserStoryModal);
        bsModal.hide();
        return false;
    });
    $("#changeName").submit(function (e) {
        var modalBodyInput = chNameModal.querySelector('.modal-body input');
        // Get the new name
        player.name = modalBodyInput.value;
        localStorage.setItem("name", player.name);
        socket.emit("newName", { room: room, newName: player.name });

        e.preventDefault();
        bsModal = bootstrap.Modal.getInstance(chNameModal);
        bsModal.hide();
        return false;
    });
    $("#kickPlayerModal").submit(function (e) {
        var modalBodyInput = kickPlayerModal.querySelector('.modal-body input');
        // Get the new name
        var participant = modalBodyInput.value;
        socket.emit("kickPlayer", { room: room, participant: participant });

        e.preventDefault();
        bsModal = bootstrap.Modal.getInstance(kickPlayerModal);
        bsModal.hide();
        return false;
    });
    chUserStoryModal.addEventListener('shown.bs.modal', function (e) {
        var modalBodyInput = chUserStoryModal.querySelector('.modal-body input');
        modalBodyInput.value = $("#userStory").html();
        document.getElementById('newUserStory').focus();
        document.getElementById('newUserStory').select();
    });
    kickPlayerModal.addEventListener('shown.bs.modal', function (e) {
        var participant = $(e.relatedTarget).data('participant');
        var modalBodyInput = kickPlayerModal.querySelector('.modal-body input');
        modalBodyInput.value = participant;
    });
    chNameModal.addEventListener('shown.bs.modal', function (event) {
        var modalBodyInput = chNameModal.querySelector('.modal-body input');
        modalBodyInput.value = player.name;
        document.getElementById('newName').focus();
    });

    chNameModal.addEventListener('hidden.bs.modal', function (event) {
        // alert(event);
    })

    /**
     * Get Planning !
     */
    $("#getPlanning").click(function (event) {
        $("#preGame").hide();
        $("#game").show(function () {
            $("#game").find("input").focus();
        });
        event.preventDefault();
    });

    $("#shareLink").click(function (e) {
        var currentRoomUrl = baseUrl + "room/" + String(room);
        let finalURL = "/qr/?url=" + currentRoomUrl;
        finalURL = $("<textarea/>").text(finalURL).html();
        $("#qrCode").html("");
        $("#qrCode").append("<img src='" + finalURL + "' class='col-6 col-md-3 img-thumbnail img-responsive' />");

        $("#preGame").removeClass("d-none");
        $("#preGame").show();
        $("#game").hide();
        e.preventDefault();
    });

    /**
     * Select card
     */
    $(".cardSelection").click(function (event) {
        // Get the selected card value
        player.card = $(this).html();
        socket.emit("cardSelected", { room: room, card: player.card });
        event.preventDefault();
    });

    $("#watchOnly").click(function (e) {
        player.card = undefined;
        player.watch = !player.watch;
        updateWatchChb();
        socket.emit("cardSelected", { room: room, card: undefined, watch: player.watch });
    });

    /**
     * Reveal Cards | Play Again
     */
    $(document).on("click", "#actionBtn", function (e) {
        if (!ui.cardsRevealed) {
            socket.emit("revealCards", { room: room });
            e.preventDefault();
        } else {
            socket.emit("playAgain", { room: room });
            var audio = new Audio(`/audio/new.ogg`);
            audio.play();
            bsModal = new bootstrap.Modal(chUserStoryModal);
            bsModal.show();
            e.preventDefault();
        }
    });
});


/**
 * Functions
 */
function updateWatchChb() {
    localStorage.setItem("watch", player.watch);

    if (player.watch) {
        $("#watchOnly").addClass('btn-primary');
    } else {
        $("#watchOnly").removeClass('btn-primary');
    }
}

function updateParticipants(clients) {
    // Clear the participant's list
    $("#participants").html("");

    // Initialize vars
    var i;
    participants.players = 0;
    participants.watcher = 0;

    for (i in clients) {
        if (clients.hasOwnProperty(i)) {
            person = $.parseJSON(clients[i]);
            icon = "";
            // current client
            if (i == player.id && person.watch !== undefined) {
                player.watch = person.watch;
                updateWatchChb();
            }
            var kickDisabled = ' disabled';
            if (person.watch) {
                icon_css = "fa-eye";
            } else if (person.card) {
                icon_css = "fa-check";
            } else {
                kickDisabled = '';
                icon_css = "fa-hourglass";
            }
            icon = "<i class='fa " + icon_css + " fa-sm mx-2' aria-hidden='true'></i>";
            kick_icon = "<i class='fas fa-user-slash fa-xs'></i>";
            kick_button = '<button type="button" class="btn close float-end' + kickDisabled
                + '" aria-label="Close" data-bs-toggle="modal" data-participant="'
                + i + '" data-bs-target="#kickPlayerModal">' + kick_icon + '</button>';

            // Differentiate current client
            if (i == player.id) {
                $("#participants").append('<div class="p-0 list-group-item btn-group active" role="group">'
                    + icon
                    + '<button type="button" class="text-start btn btn-block" data-bs-toggle="modal" data-bs-target="#chNameModal">'
                    + person.name
                    + '</button>'
                    + kick_button
                    + '</div>'
                );
            } else {
                $("#participants").append('<div class="p-0 list-group-item btn-group" role="group">'
                    + icon
                    + '<button type="button" class="text-start btn btn-block disabled">'
                    + person.name
                    + '</button>'
                    + kick_button
                    + '</div>'
                );
            }
            if (person.watch) {
                participants.watcher++;
            } else {
                participants.players++;
            }
        }
    }
    $("#participantsNo").text(participants.players);
    $("#participantWathNo").text(participants.watcher);
}

function generateRandomString() {
    var howmany = 6;
    var input = "abcdefghijklmnopqrstuvwxyz0123456789";
    var output = new Array();
    var input_arr = input.split("");
    var input_arr_len = input_arr.length;

    for (x = 0; x < howmany; x++) {
        output[x] = input_arr[Math.floor(Math.random() * input_arr_len)];
    }

    output = output.join("");
    return output;
}

// Creates an alert, feed with alert type and content
function newAlert(type, header, msg) {
    var random_id = generateRandomString();

    var toast = $('div#alert.toast').clone().prop("id", "toast_" + random_id);
    toast.removeClass("d-none");
    toast.addClass('alert-' + type);
    toast.find("strong").html(header);
    toast.find('.toast-body').html(msg);

    $("#alerts").append(toast);

    toastEl = new bootstrap.Toast(toast.get(0));
    toastEl.show();

    setTimeout(function () {
        $("#toast_" + random_id).remove();
    }, 30000);
}

function updateProgressBar(progress) {
    $("#progressBar div").css("width", progress + "%");
}

function displayCards(clients) {
    // Clear the current cards
    $("#cardsResult").html("");

    // Initialize vars
    var count = 0;
    for (var i in clients) {
        if (clients.hasOwnProperty(i)) {
            person = $.parseJSON(clients[i]);

            // Check only people who chose cards
            if (person.card !== undefined) {
                if (i == player.id && !player.card) {
                    continue;
                }
                var card = $("#defcard").clone().prop("id", "card_" + count);
                card.show();
                card.addClass("cards");
                card.removeClass("d-none");

                // Differentiate current client
                if (i == player.id) {
                    if (person.card == "^") {
                        person.card = player.card;
                    }
                    card.find("h4").html(person.name);
                    card.find(".points").html(person.card);
                } else {
                    if (person.card == "^") {
                        person.card = "<i class='fas fa-check'></i>";
                    }
                    card.find("h4").html(person.name);
                    card.find(".points").html(person.card);
                }
                $("#cardsResult").append(card);
                count++;
            }
        }
    }
    // Getting progression Status
    var progress = (100 * count) / participants.players;
    updateProgressBar(progress);

    $("#actionBtn").removeClass('btn-success');
    $("#actionBtn").removeClass('btn-info');
    $("#actionBtn").removeClass('btn-light');

    if (ui.pauseRemaining) {
        disableCards(clients);
        $("#actionBtn").addClass('disabled');
        $("#actionBtn").addClass('btn-light');
        $("#actionText").html("Please wait (" + ui.pauseRemaining + ")");
    } else if (ui.cardsRevealed) {
        disableCards(clients);
        $("#actionBtn").removeClass('disabled');
        $("#actionBtn").addClass('btn-info');
        $("#actionText").html("Play Again");

        if (!isSfxPlaying) {
            var audio = new Audio(`/audio/${sfxIndex}.ogg`);
            audio.play();
            isSfxPlaying = true;
        }
    } else if (progress > 99) {
        enableCards(clients);
        $("#actionBtn").removeClass('disabled');
        $("#actionBtn").addClass('btn-success');
        $("#actionText").html("Reveal cards");
    } else {
        enableCards(clients);
        $("#actionBtn").addClass('disabled');
        $("#actionBtn").addClass('btn-light');
        $("#actionText").html("&#8987;"); // hourglass
    }
}

function disableCards(clients) {
    console.log("Disable Cards: ", $("#userStory").html(), clients);

    $(".playcard").each(function () {
        $(this).find(".card-body").removeClass("bg-body");
        $(this).find(".card-body").addClass("bg-info");
    });

    // Disable card buttons to prevent user from changing it's value
    $("#cardsSelection button").attr("disabled", "disabled");
    ui.cardsButtonDisabled = true;
}

function enableCards(clients) {
    console.log("Enable Cards: ", $("#userStory").html(), clients);
    $(".playcard").each(function () {
        $(this).find(".card-body").removeClass("bg-info");
        $(this).find(".card-body").addClass("bg-body");
    });

    // Enable card buttons
    $("#cardsSelection button").removeAttr("disabled");
    ui.cardsButtonDisabled = true;
}
