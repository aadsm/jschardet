#!/bin/bash

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
TC='\033[0m' # Terminal color

function calc_perc {
  # Calculate the percentage up to 2 decimal places and leading 0 when the
  # percentage only has the decimal part. Only print percentages >= 0.01%.
  bc <<EOF
    scale=2;
    define abs2(x) { if (x < 0) return -x; return x }
    ratio=$1/$2;
    if (ratio >= 0.01) {
      if (ratio < 0) {
        print "-"
      } else {
        print "+"
      }
      if (abs2(ratio) < 1) {
        print "0"
      }
      print abs2(ratio)
      print "% "
    }
EOF
}

eval "git diff-index HEAD $@" | {
  # vars: B=before / A=after
  # mode: A=added / D=deleted
  while read maskB maskA hashB zero mode path; do
    if [ $mode = "A" ]; then
      sizeB=0;
    else
      sizeB=$(git cat-file -s $hashB)
    fi
    if [ $mode = "D" ]; then
      sizeA=0
    else
      # warning: -s is bsd only
      eval $(stat -s "$path")
      sizeA=$st_size
    fi
    size_diff=$(( $sizeA - $sizeB ))
    if [ $size_diff -gt 0 ]; then
      size_diff_signal="+"
      size_diff_color=$RED
    else
      size_diff_color=$GREEN
    fi

    # Calculate the percentage up to 2 decimal places and leading 0 when the
    # percentage only has the decimal part. Only print percentages >= 0.01%.
    # bc_expr="scale=2; v=$size_diff/$sizeB"
    # bc_expr=$bc_expr'; if (v >= 0.01) { if (v < 0) { print "-" } else { print "+" }; if (abs(v) < 1) print "0"; print abs(v); print "% " }; print ""'
    # perc=$(echo "$bc_expr" | bc)
    perc=$(calc_perc $size_diff $sizeB)
    echo -e "$path $size_diff_color$size_diff_signal$size_diff $perc$TC($sizeB -> $sizeA)"
  done
}
