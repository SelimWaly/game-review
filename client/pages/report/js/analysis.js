let ongoingEvaluation = false;
let evaluatedPositions = [];

function logAnalysisInfo(message) {
    $("#status-message").css("color", "white");
    $("#status-message").html(message);
}

function logAnalysisError(message) {
    $("#secondary-message").css("display", "none");
    $("#status-message").css("color", "rgb(255, 53, 53)");
    $("#status-message").html(message);
}

async function evaluate() {

    if (ongoingEvaluation) return;
    ongoingEvaluation = true;

    let pgn = $("#pgn").val();
    let depth = parseInt($("#depth-slider").val());

    // Content validate PGN input
    if (pgn.length == 0) {
        return logAnalysisError("Enter a PGN to analyse.");
    }

    // Update profile cards and display secondary message
    $("#white-player-profile").html(pgn.match(/(?<=\[White ").+(?="\])/)[0]);
    $("#black-player-profile").html(pgn.match(/(?<=\[Black ").+(?="\])/)[0]);
    $("#secondary-message").html("It can take around a minute to process a full game.")
    $("#secondary-message").css("display", "inline");

    $(".g-recaptcha").css("display", "none");
    grecaptcha.reset();

    // Post PGN to server to have it parsed
    logAnalysisInfo("Parsing PGN...");

    try {
        // JSON list with keys fen and move. move = SAN
        var positions = await REST.post("/api/parse", { pgn });
    } catch (err) {
        return logAnalysisError("Failed to parse PGN file.");
    }

    // Display progress bar
    $("#evaluation-progress-bar").css("display", "inline");

    // Initialise positions for processing and fetch cloud evaluations where possible
    for (let position of positions) {
        position.evaluation = null;
        position.worker = null;
    }
    let workerCount = 0;

    // Fetch cloud evaluations where possible
    for (let position of positions) {
        let queryFen = position.fen.replace(/\s/g, "%20");
        
        let cloudEvaluation = await REST.get("https://lichess.org/api/cloud-eval?fen=" + queryFen);
        if (typeof cloudEvaluation == "object") {
            position.evaluation = {
                type: cloudEvaluation.pvs[0].cp ? "cp" : "mate",
                value: cloudEvaluation.pvs[0].cp ?? cloudEvaluation.pvs[0].mate
            };

            position.worker = { depth };
        } else {
            break;
        }

        let progress = (positions.indexOf(position) + 1) / positions.length * 100;
        $("#evaluation-progress-bar").attr("value", progress);
        logAnalysisInfo(`Evaluating positions... (${progress.toFixed(1)}%)`);
    }

    // Evaluate remaining positions
    let stockfishManager = setInterval(() => {
        // If all evaluations have been generated, move on
        if (!positions.some(pos => pos.evaluation == null)) {
            clearInterval(stockfishManager);

            logAnalysisInfo("Evaluation complete.");
            $(".g-recaptcha").css("display", "inline");
            $("#secondary-message").html("Please complete the CAPTCHA to continue.");

            evaluatedPositions = positions;
            ongoingEvaluation = false;
            return;
        }

        // Find next position with no worker and add new one
        for (let position of positions) {
            if (position.worker != null || workerCount >= 8) continue;

            position.worker = new Stockfish();
            position.worker.evaluate(position.fen, depth).then(evaluation => {
                position.evaluation = evaluation;
                workerCount--;
            });

            workerCount++;
        }

        // Update progress monitor
        let workerDepths = 0;
        for (let position of positions) {
            if (position.evaluation == null) {
                workerDepths += position.worker == null ? 0 : position.worker.depth;
            } else {
                workerDepths += depth;
            }
        }

        let progress = workerDepths / (positions.length * depth) * 100;

        $("#evaluation-progress-bar").attr("value", progress);
        logAnalysisInfo(`Evaluating positions... (${progress.toFixed(1)}%)`);
    }, 10);

}

async function report() {

    console.log("ALL POSITIONS EVALUATED SUCCESSFULLY");
    console.log(evaluatedPositions);

    // Post evaluations and get report results
    try {
        var results = await REST.post("/api/report", {
            positions: evaluatedPositions.map(pos => {
                pos.worker = undefined;
                return pos;
            }),
            captchaToken: grecaptcha.getResponse()
        });

        if (typeof results == "string") {
            return logAnalysisError(results);
        }
    } catch (err) {
        console.log(err);
        return logAnalysisError("Failed to generate report.");
    }

    console.log(results);

}

$("#review-button").click(evaluate);

$("#depth-slider").on("input", () => {
    let depth = parseInt($("#depth-slider").val());

    if (depth <= 15) {
        $("#depth-counter").html(depth + " ⚡");
    } else if (depth <= 18) {
        $("#depth-counter").html(depth + " 🐇");
    } else {
        $("#depth-counter").html(depth + " 🐢");
    }
});