

function showTooltip(tooltipAnchor, entity) {
    const type = entity.datum.type;
    if (type === 'review') {
        const review = entity.datum;
        tooltipAnchor.html(`
        <span class='heading'>${review['Review Title']} (${review['Star Rating']}/5)</span>
        <span class='body'>${review['Review Text']}</span>
        `);
    } else if (type === 'issue') {
        const issue = entity.datum;
        const labelHtml = issue.labels
            .map(l => {
                return `<span class='label' style='background:#${l.color}'>${l.name.toUpperCase()}</span>`;
            })
            .join(' ');
        tooltipAnchor.html(`
        <span class='heading'>[${issue.state}] ${issue.title} (${issue.user.login})</span>
        <span class='body'>${labelHtml}</span>
        `);
    } else if (type === 'commit') {
        const commit = entity.datum;
        tooltipAnchor.html(`
        <span class='heading'>${commit.commit.author.name}</span>
        <span class='body'>${commit.commit.message}<br /><a href='${commit.html_url}' target='_blank'>View Here</a></span>
        `);
    } else if (type === 'crash') {
        const crash = entity.datum;
        tooltipAnchor.html(`
        <span class='heading'>Crash: ${crash['Exception Class Name']} at ${moment(crash['Crash report Date And Time']).format()}</span>
        <span class='body'>App Verion: ${crash['App Version Name']}(${crash['App Version Code']})<br />Android Version: ${crash['Android OS Version']}<br /><a href='${crash['Crash Link']}' target='_blank'>View Here</a></span>
        `);
    }


    tooltipAnchor.css({
        left: entity.position.x - (tooltipAnchor.width() / 2),
        top: entity.position.y + Number(tooltipAnchor.attr('data-top-offset')) - (tooltipAnchor.height() + 20)
    }).show();
}


function renderNodes(points, targetQueryString) {

    var fillColorScale = new Plottable.Scales.Color()
        .domain(["commit", "issue", "badReview (<=3)", "terribleReview (<=1)", "crash"])
        .range(["#0052A5", "pink", "orange", "red", "purple"]);

    var legend = new Plottable.Components.Legend(fillColorScale);
    var title = new Plottable.Components.TitleLabel("Testing", 0)
        .yAlignment("top");

    var xScale = new Plottable.Scales.Time()
        .domain([new Date(points[0].x), new Date(points[points.length - 1].x)]);
    const yScale = new Plottable.Scales.Category();

    const xAxis = new Plottable.Axes.Time(xScale, 'top')
        .margin(5)
        .annotationsEnabled(true);

    const releases = points.reduce((acc, point) => { //Crap because we're using reviews to infer releases
        if (point.type !== 'review') return acc;
        const releaseVersion = point['App Version Name'];
        if (!releaseVersion) return acc;
        const releaseExists = acc[releaseVersion];
        const reviewDate = moment(point['Review Submit Date and Time']).valueOf();

        if (!releaseExists) {
            acc[releaseVersion] = { min: reviewDate, max: reviewDate };
        } else {
            if (reviewDate < releaseExists.min) acc[releaseVersion].min = reviewDate;
            if (reviewDate > releaseExists.max) acc[releaseVersion].max = reviewDate;
        }
        return acc;
    }, {});

    const releaseRanges = Object.keys(releases).reverse().map((version, index) => {
        return {
            version,
            x: releases[version].min,
            x2: releases[version].max,
            index
        };
    });

    const releasePlot = new Plottable.Plots.Segment()
        .x(d => d.x, xScale)
        .y(d => 100 * d.index, new Plottable.Scales.Linear())
        .x2(d => d.x2)
        .y2(d => 100 * d.index)
        .addDataset(new Plottable.Dataset(releaseRanges));

    var plot = new Plottable.Plots.Scatter()
        .addDataset(new Plottable.Dataset(points))
        .x(function (d) { return new Date(d.x); }, xScale)
        .y(function (d) {
            return ({
                commit: 50,
                issue: 150,
                review: 250
            })[d.type];
        }, yScale)
        .attr("fill", function (d) {
            if (d.type === 'review') {
                if (d['Star Rating'] <= 1) {
                    return 'terribleReview (<=1)'
                } else if (d['Star Rating'] <= 3) {
                    return 'badReview (<=3)';
                }
            } else {
                return d.type;
            }
        }, fillColorScale)
        .size(50);

    var guideline = new Plottable.Components.GuideLineLayer("vertical")
        .scale(xScale);
        
    const chart = new Plottable.Components.Table([
        [title],
        [xAxis],
        [new Plottable.Components.Group([guideline, plot, legend, dragbox])]
    ]).renderTo(targetQueryString);


    // Initializing tooltip anchor
    var tooltipAnchor = $('<div>').addClass('tt').appendTo('body');
    tooltipAnchor.attr('data-top-offset', $(plot._foregroundContainer[0][0]).position().top);

    new Plottable.Interactions.PanZoom(xScale, null)
        .attachTo(plot);

    new Plottable.Interactions.Pointer()
        .attachTo(plot)
        .onPointerMove(function (p) {
            var entity = plot.entityNearest(p);
            if (entity) {
                var date = new Date(entity.datum.x);
                guideline.value(date);
                xAxis.annotatedTicks([date]);

                showTooltip(tooltipAnchor, entity);
            }
        })
        .onPointerExit(function () {
            guideline.pixelPosition(-10);
            xAxis.annotatedTicks([]);
            //tooltipAnchor.fadeOut();
        });

}

const paths = [
    'app/src/test',
    'app/src/androidTest',
    'app/src/androidTestKiwix'
];

let loadGithubData;
const haveCachedData = !!localStorage.githubData;
if (haveCachedData) {
    loadGithubData = Promise.resolve(JSON.parse(localStorage.githubData));
} else {
    loadGithubData = Promise.all([
        Promise.all( //Commits
            paths.map(path => {
                return fetch(`https://api.github.com/repos/kiwix/kiwix-android/commits?path=${path}`)
                    .then(res => res.json());
            })
        ).then((responses) => {
            const data = responses.reduce((acc, res) => acc.concat(res), []).map(p => {
                p.type = 'commit';
                p.x = moment(p.commit.committer.date).valueOf();
                return p;
            });
            return data;
        }),
        fetch(`https://api.github.com/repos/kiwix/kiwix-android/issues`)
            .then(response => response.json())
            .then(res => res.map(p => {
                p.type = 'issue'
                p.x = moment(p.created_at).valueOf();
                return p;
            })),
        fetch(`./ratings.json`)
            .then(response => response.json())
            .then(res => {
                return res
                    .filter(p => p['Star Rating'] <= 3)
                    .map(p => {
                        p.type = 'review'
                        p.x = moment(p['Review Submit Date and Time']).valueOf();
                        return p;
                    });
            }),
        fetch(`./crashes.json`)
            .then(response => response.json())
            .then(res => {
                return res
                    .map(p => {
                        p.type = 'crash'
                        p.x = moment(p['Crash Report Date And Time']).valueOf();
                        return p;
                    });
            })
    ]).then(types => {
        const data = types.reduce((acc, res) => acc.concat(res), []);
        localStorage.githubData = JSON.stringify(data);
        return data;
    });
}

loadGithubData
    .then(data => data.sort((a, b) => a.x > b.x ? 1 : -1))
    .then(data => {
        renderNodes(data, '.commit-timeline');
    });
