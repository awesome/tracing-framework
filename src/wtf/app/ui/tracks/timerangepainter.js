/**
 * Copyright 2012 Google, Inc. All Rights Reserved.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

/**
 * @fileoverview Trace time range painting context.
 *
 * @author benvanik@google.com (Ben Vanik)
 */

goog.provide('wtf.app.ui.tracks.TimeRangePainter');

goog.require('wtf.events');
goog.require('wtf.events.EventType');
goog.require('wtf.math');
goog.require('wtf.ui.ModifierKey');
goog.require('wtf.ui.RangePainter');
goog.require('wtf.ui.color.Palette');
goog.require('wtf.util');



/**
 * Paints a time range region into the view.
 * @param {!HTMLCanvasElement} canvas Canvas element.
 * @param {!wtf.analysis.db.EventDatabase} db Database.
 * @param {!wtf.analysis.db.TimeRangeIndex} timeRangeIndex Time range index.
 * @constructor
 * @extends {wtf.ui.RangePainter}
 */
wtf.app.ui.tracks.TimeRangePainter = function(canvas, db, timeRangeIndex) {
  goog.base(this, canvas);
  var dom = this.getDom();

  /**
   * Database.
   * @type {!wtf.analysis.db.EventDatabase}
   * @private
   */
  this.db_ = db;

  /**
   * Time range index.
   * @type {!wtf.analysis.db.TimeRangeIndex}
   * @private
   */
  this.timeRangeIndex_ = timeRangeIndex;

  /**
   * Y offset, in pixels.
   * @type {number}
   * @private
   */
  this.y_ = 200;

  // TODO(benvanik): a better palette.
  /**
   * Color palette used for drawing marks.
   * @type {!wtf.ui.color.Palette}
   * @private
   */
  this.palette_ = new wtf.ui.color.Palette(
      wtf.ui.color.Palette.SCOPE_COLORS);

  this.timeRangeIndex_.addListener(wtf.events.EventType.INVALIDATED,
      function() {
        this.requestRepaint();
      }, this);
};
goog.inherits(wtf.app.ui.tracks.TimeRangePainter, wtf.ui.RangePainter);


/**
 * Height of a time range, in pixels.
 * @type {number}
 * @const
 */
wtf.app.ui.tracks.TimeRangePainter.TIME_RANGE_HEIGHT_ = 16;


/**
 * @override
 */
wtf.app.ui.tracks.TimeRangePainter.prototype.repaintInternal = function(
    ctx, bounds) {
  var palette = this.palette_;

  // HACK(benvanik): remove once layout is implemented.
  bounds.top = this.y_;

  var width = bounds.width;
  var height = bounds.height;

  this.beginRenderingRanges(bounds, this.timeRangeIndex_.getMaximumLevel());

  var timeLeft = this.timeLeft;
  var timeRight = this.timeRight;
  this.timeRangeIndex_.forEachIntersecting(timeLeft, timeRight,
      function(timeRange) {
        var beginEvent = timeRange.getBeginEvent();
        var endEvent = timeRange.getEndEvent();

        // Compute screen size.
        var startTime = beginEvent.time;
        var endTime = endEvent.time;
        var left = wtf.math.remap(startTime, timeLeft, timeRight, 0, width);
        var right = wtf.math.remap(endTime, timeLeft, timeRight, 0, width);
        var screenWidth = right - left;

        // Clip with the screen.
        var screenLeft = Math.max(0, left);
        var screenRight = Math.min(width - 0.999, right);
        if (screenLeft >= screenRight) {
          return;
        }

        // Compute color by name.
        var label = timeRange.getName();
        if (!label) {
          return;
        }
        var color = palette.getColorForString(label);

        // Draw bar.
        var level = timeRange.getLevel();
        this.drawRange(level, screenLeft, screenRight, color, 1);

        if (screenWidth > 15) {
          var y = level * wtf.app.ui.tracks.TimeRangePainter.TIME_RANGE_HEIGHT_;
          this.drawRangeLabel(
              bounds, left, right, screenLeft, screenRight, y, label);
        }
      }, this);

  // Now blit the nicely rendered ranges onto the screen.
  var y = 0;
  var h = wtf.app.ui.tracks.TimeRangePainter.TIME_RANGE_HEIGHT_;
  this.endRenderingRanges(bounds, y, h);
};


/**
 * @override
 */
wtf.app.ui.tracks.TimeRangePainter.prototype.onClickInternal =
    function(x, y, modifiers, bounds) {
  var timeRange = this.hitTest_(x, y, bounds);
  if (!timeRange) {
    return false;
  }

  var timeStart = timeRange.getBeginEvent().time;
  var timeEnd = timeRange.getEndEvent().time;

  var commandManager = wtf.events.getCommandManager();
  commandManager.execute('goto_range', this, null, timeStart, timeEnd);
  if (modifiers & wtf.ui.ModifierKey.SHIFT) {
    commandManager.execute('select_range', this, null, timeStart, timeEnd);
  }

  return true;
};


/**
 * @override
 */
wtf.app.ui.tracks.TimeRangePainter.prototype.getInfoStringInternal =
    function(x, y, bounds) {
  var timeRange = this.hitTest_(x, y, bounds);
  if (!timeRange) {
    return undefined;
  }

  var duration = timeRange.getTotalDuration();
  var lines = [
    wtf.util.formatTime(duration) + ': ' + timeRange.getName()
  ];
  wtf.util.addArgumentLines(lines, timeRange.getData());
  return lines.join('\n');
};


/**
 * Finds the time range at the given point.
 * @param {number} x X coordinate, relative to canvas.
 * @param {number} y Y coordinate, relative to canvas.
 * @param {!goog.math.Rect} bounds Draw bounds.
 * @return {wtf.analysis.TimeRange} Time range or nothing.
 * @private
 */
wtf.app.ui.tracks.TimeRangePainter.prototype.hitTest_ = function(
    x, y, bounds) {
  // HACK(benvanik): remove once layout is implemented.
  bounds.top = this.y_;
  bounds.height = 1000;

  var width = bounds.width;
  var height = bounds.height;
  if (y < bounds.top || y > bounds.top + bounds.height) {
    return null;
  }

  var h = wtf.app.ui.tracks.TimeRangePainter.TIME_RANGE_HEIGHT_;
  var level = ((y - bounds.top) / h) | 0;
  var time = wtf.math.remap(x, 0, width, this.timeLeft, this.timeRight);
  var e = this.timeRangeIndex_.search(time, function(e) {
    if (e.value.getLevel() == level) {
      var beginEvent = e.value.getBeginEvent();
      var endEvent = e.value.getEndEvent();
      if (e.time <= beginEvent.time && time <= endEvent.time) {
        return true;
      }
    }
    return false;
  });
  return e ? e.value : null;
};
