/**
 * TODO: extract configuration
 */

var express = require('express');
var bodyParser = require('body-parser');
var morgan = require('morgan');
var Promise = require('bluebird');
var _ = require('underscore');
var http = require('http');

var env = process.env.ENV;

var util = require('./lib/util');
var cors = require('./lib/cors.js');
var logger = require('./lib/logger.js').logger;
var mpdWrapper = require('./lib/mpd-wrapper')(env, 'localhost', 6600, logger);
var dbWrapper = require('./lib/db-wrapper')(logger);

//
// promisify expects functions that take arguments with a callback as the last parameter
// the callback must pass the error as it's first parameter and a result as the second
// in case there are multiple results then they are converted into an array
//
var mpd = Promise.promisifyAll(mpdWrapper);
var db = Promise.promisifyAll(dbWrapper);

var routeUtil = require('./lib/routes/route-util')(db, mpd, logger);

var app = express();
var server = null;

// app.use(morgan('dev'));

app.use(cors.allowAll);
app.use(bodyParser.urlencoded({ extended: false })); // parse application/x-www-form-urlencoded
app.use(bodyParser.json()); // parse application/json


//
// playlist routes
//

app.get('/api/playlist/played', function (req, res, next) {

  mpd.getPlayedSongsAsync(10)
    .then(function (playlist) {
      return routeUtil.enhanceSongsWithVotes(playlist);
    })
      .then(function (songs) {
          return routeUtil.enhanceSongsWithRelativeTimeBeforeNow(songs);
      })
    .then(function (songs) {
      res.send(songs);
    })
    .catch(function (err) {
      next(err);
    });

});

app.get('/api/playlist/upcoming', function (req, res, next) {

  var userId = req.query.userId;

  mpd.getUpcomingSongsAsync()
    .then(function (playlist) {
      return routeUtil.enhanceSongsWithVotes(playlist);
    })
    .then(function (songs) {
      if (userId) {
        return routeUtil.enhanceSongsWithUserInfo(userId, songs);
      } else {
        return songs;
      }
    }).then(function (songs) {
          return routeUtil.enhanceSongsWithRelativeTimeAfterNow(songs);
    }).then(function (songs) {
      res.send(songs);
    })
    .catch(function (err) {
      next(err);
    });

});

/**
 * if the current song is empty then we simply clear the playlist :)
 */
app.get('/api/playlist/current', function (req, res, next) {

  mpd.getCurrentSongAsync()
    .then(function (song) {
      if (song.id) {
        return routeUtil.enhanceSongsWithVotes([song])
          .then(function (songs) {
            res.send(songs[0]);
          })
      }

      return mpd.clearAsync()
        .then(function () {
          res.status(200).send();
        });

    })
    .catch(function (err) {
      next(err);
    });

});

/**
 * TODO: check if the added song is equal to the current song and bail if it is
 */
app.get('/api/playlist/add', function (req, res, next) {

  var data = req.query;

  // api fix
  if (data.fileName) {
    data.filename = data.fileName;
  }

  logger.debug('adding ' + data.filename + ' by ' + data.userId);

  //
  // if user not found then cannot add song
  //
  // get the user, get the upcoming song list
  // refresh the user queue with what is in the upcoming song list
  // if the queue has space then
  //   check if the song is not already on the queue
  //   if yes, then save user and return
  //   if no, then add song to the playlist, update playcount, update the user queue, save user and return
  //

  db.getUserAsync(data.userId)
    .then(function (user) {

      if (user) {

        return mpd.getUpcomingSongsAsync()
          .then(function (songs) {

            user = routeUtil.updateUserQueue(user, songs);

            if (user.queue.length >= 3) {
              return 403;
            } else { // user queue has space, so add it to the queue

              user.queue.push(data.filename);

              var exists = routeUtil.songExists(data.filename, songs);

              // console.log([songs, user.queue, data.filename]);

              if (exists) { // song already exists in the upcoming list, so save the user and return

                return db.updateUserAsync(user)
                  .then(function (results) {
                    return 200;
                  });

              } else { // add it to the playlist, save the user and return

                return mpd.addSongToPlaylistAsync(data.filename)
                  .then(function () {
                    return db.updatePlayCountAsync(data.filename);
                  })
                  .then(function (playCount) {
                    // logger.debug('updating user ' + user.queue.length);
                    return db.updateUserAsync(user);
                  })
                  .then(function (results) {
                    return 200;
                  });
              }
            }
          });
      }

      // no user found
      return 401;

    })
    .then(function (status) {

      return mpd.getStatusAsync()
        .then(function (playerStatus) {

          if (playerStatus.state === 'play') {
            return status;
          }

          return mpd.startPlaybackAtEndAsync()
            .then(function (result) {
              return status;
            });
        });
    })
    .then(function (status) {
      res.status(status).send();
    })
    .catch(function (err) {
      next(err);
    });

});


//
// user routes
//

app.get('/api/user/:id', function (req, res, next) {

  db.getUserAsync(req.params.id)
    .then(function (user) {

      if (user) { // user found, get their votes and return it

        user.votes = {};

        return db.getUserVotesAsync(user._id)
          .then(function (votes) {

            _.each(votes, function (vote) {
              user.votes[vote.songId] = vote.value;
            })

            return user;
          });

      } else { // no user found, we create one, add it to the db and return it

        var u = {
          _id: req.params.id
        }

        return db.addUserAsync(u)
          .then(function (inserted) {
            inserted.votes = {};
            return inserted;
          });
      }

    })
    .then(function (user) {
      res.send(user);
    })
    .catch(function (err) {
      next(err);
    });

});

//
// vote routes
//

require('./lib/routes/vote')(app, db, logger);

//
// music db routes
//
require('./lib/routes/music')(app, mpd, db, logger);

//
// player routes
//

// require('./lib/routes/player')(app, mpd, logger);

// api takes top precedence
app.use(express.static(__dirname + '/public'));

app.use(function (err, req, res, next) {

    logger.error(err + '');
    res.header('Error', err);

    if (util.isNumber(err)) {
      res.status(err).send();
      return;
    }

    res.status(500).send();

});

var init = function () {
  var port = 8080;
  server = http.createServer(app).listen(port);
  logger.info('listening on ' + port);
};

var destroy = function () {
  server.close(function () {
    logger.info('shutdown app');
  });
};

exports.init = init;
exports.destroy = destroy;

if (!module.parent)
{
  init();
};
