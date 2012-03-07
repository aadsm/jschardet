/*
 * The Original Code is Mozilla Universal charset detector code.
 *
 * The Initial Developer of the Original Code is
 * Netscape Communications Corporation.
 * Portions created by the Initial Developer are Copyright (C) 2001
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   António Afonso (antonio.afonso gmail.com) - port to JavaScript
 *   Mark Pilgrim - port to Python
 *   Shy Shalom - original C code
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 * 
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 * 
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA
 * 02110-1301  USA
 */

var jschardet = exports;

require('./constants')(jschardet);
require('./codingstatemachine')(jschardet);
require('./escsm')(jschardet);
require('./mbcssm')(jschardet);
require('./charsetprober')(jschardet);
require('./mbcharsetprober')(jschardet);
require('./jisfreq')(jschardet);
require('./gb2312freq')(jschardet);
require('./euckrfreq')(jschardet);
require('./big5freq')(jschardet);
require('./euctwfreq')(jschardet);
require('./chardistribution')(jschardet);
require('./jpcntx')(jschardet);
require('./sjisprober')(jschardet);
require('./utf8prober')(jschardet);
require('./charsetgroupprober')(jschardet);
require('./eucjpprober')(jschardet);
require('./gb2312prober')(jschardet);
require('./euckrprober')(jschardet);
require('./big5prober')(jschardet);
require('./euctwprober')(jschardet);
require('./mbcsgroupprober')(jschardet);
require('./sbcharsetprober')(jschardet);
require('./langgreekmodel')(jschardet);
require('./langthaimodel')(jschardet);
require('./langbulgarianmodel')(jschardet);
require('./langcyrillicmodel')(jschardet);
require('./hebrewprober')(jschardet);
require('./langhebrewmodel')(jschardet);
require('./langhungarianmodel')(jschardet);
require('./sbcsgroupprober')(jschardet);
require('./latin1prober')(jschardet);
require('./escprober')(jschardet);
require('./universaldetector')(jschardet);

jschardet.VERSION = "0.1";
jschardet.detect = function(buffer) {
    var u = new jschardet.UniversalDetector();
    u.reset();
    if( buffer instanceof Buffer ) {
        var str = "";
        for (var i = 0; i < buffer.length; ++i)
            str += String.fromCharCode(buffer[i])
        u.feed(str);
    } else {
        u.feed(buffer);
    }
    u.close();
    return u.result;
}
