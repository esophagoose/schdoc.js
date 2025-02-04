/*

altium.js schematic document parser

Copyright (c) 2023 esophagoose, Graham Sutherland

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

class AltiumRecord
{
	constructor(record_id, data_block, index)
	{
		this.record_id = record_id
		this.record_index = index;
		this.data = data_block;

		const regex = /(?:\|(?<name>[^|=]+?)=(?<value>[^|]+))/gm;
		this.attributes = Array.from(this.data.matchAll(regex), (m) => m.groups);
	}
}

class AltiumObject
{
	static RecordObjectMap = [];
	
	constructor(record)
	{
		this.record_id = record.record_id;
		this.record_index = record.record_index;
		this.source_record = record;
		this.attributes_raw = record.attributes;
		this.attributes = {};
		for (let attrib of this.attributes_raw)
		{
			this.attributes[attrib.name.toLowerCase().replaceAll('%', '_').replace('.', '_')] = attrib.value;
		}
		this.owner_record_index = Number.parseInt(this.attributes.ownerindex ?? "-1", 10);
		this.index_in_sheet = Number.parseInt(this.attributes.indexinsheet ?? "-1", 10);
		this.owner_part_id = (this.attributes.ownerpartid == null) ? null : Number.parseInt(this.attributes.ownerpartid, 10);
		this.parent_object = null;
		this.child_objects = [];
		this.owner_display_mode = Number.parseInt(this.attributes.ownerpartdisplaymode ?? "-1", 10);
	}
	
	findParent(type)
	{
		let currentParent = this.parent_object;
		const BLOWN = 1024; // nesting limit
		let fuse = 0;
		while ((++fuse != BLOWN) && (currentParent != null) && !(currentParent instanceof type))
		{
			currentParent = currentParent.parent_object;
		}
		if (fuse >= BLOWN)
			return null;
		return currentParent;
	}

	colorToHTML(color_string)
	{
		let color = Number.parseInt(color_string ?? "0")
		let low_byte = (color & 0xFF).toString(16).padStart(2, '0');
		let mid_byte = ((color >> 8) & 0xFF).toString(16).padStart(2, '0');
		let high_byte = ((color >> 16) & 0xFF).toString(16).padStart(2, '0');
		return `#${low_byte}${mid_byte}${high_byte}`
	}

	parseIntAndFloat(attrs, name)
	{
		let base = Number.parseInt(attrs[name], 10);
		let frac = Number.parseInt(attrs[`${name}_frac`] ?? "0", 10);
		return base + (frac / 100_000);
	}
}

class AltiumComponent extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 1, name: "Component", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.library_reference = this.attributes.libreference;
		this.design_item_id = this.attributes.designitemid;
		this.description = (this.attributes._utf8_componentdescription ?? this.attributes.componentdescription) ?? "";
		this.current_part_id = Number.parseInt(this.attributes.currentpartid ?? "-1", 10);
		this.display_mode = Number.parseInt(this.attributes.displaymode ?? -1, 10);;
		this.part_count = Number.parseInt(this.attributes.partcount ?? "1", 10);
		this.dnp = false;
	}
}

class AltiumPin extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 2, name: "Pin", type: this }) }
	
	constructor(record)
	{
		super(record);
		
		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.length = Number.parseInt(this.attributes.pinlength, 10);
		this.owner_display_mode = Number.parseInt(this.attributes.ownerpartdisplaymode ?? "-1", 10);
		let conglomerate = Number.parseInt(this.attributes.pinconglomerate, 10);
		this.orientation = conglomerate & 3;
		this.angle = 90 * this.orientation;
		this.name = (this.attributes._utf8_name ?? this.attributes.name) ?? "";
		this.show_name = (conglomerate & 0x8) == 0x8;
		this.designator = this.attributes.designator ?? "";
		this.show_designator = (conglomerate & 0x10) == 0x10;
		const angle_vec_table = [
			[1, 0],
			[0, 1],
			[-1, 0],
			[0, -1]
		];
		this.angle_vec = angle_vec_table[this.orientation];
		// unclear values here. python-altium docs suggest values of 0,16,21, but in practice I've only seen 5.
		this.name_orientation = Number.parseInt(this.attributes.pinname_positionconglomerate ?? "0", 10);
	}
}

class AltiumIEEESymbol extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 3, name: "IEEE Symbol", type: this }) }
	
	constructor(record)
	{
		super(record);
	}
}

class AltiumLabel extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 4, name: "Label", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.text = this.attributes.text;
		this.hidden = (this.attributes.ishidden ?? "") == "T";
		this.color = this.colorToHTML(this.attributes.color);
		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.orientation = Number.parseInt(this.attributes.orientation ?? "0", 10);
		this.justification = Number.parseInt(this.attributes.justification ?? "0", 10);
		this.font_id = Number.parseInt(this.attributes.fontid ?? "-1", 10);
	}
}

class AltiumBezier extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 5, name: "Bezier", type: this }) }
	
	constructor(record)
	{
		super(record);
	}
}

class AltiumPolyline extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 6, name: "Polyline", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.points = [];
		let idx = 1;
		while (this.attributes["x" + idx.toString()] != null)
		{
			let x = Number.parseInt(this.attributes["x" + idx.toString()], 10);
			let y = Number.parseInt(this.attributes["y" + idx.toString()], 10);
			this.points.push([x,y]);
			idx++;
		}
		this.width = Number.parseInt(this.attributes.linewidth ?? "1", 10);
		this.color = this.colorToHTML(this.attributes.color);
		this.start_shape = Number.parseInt(this.attributes.startlineshape ?? "0", 10);
		this.end_shape = Number.parseInt(this.attributes.endlineshape ?? "0", 10);
		this.shape_size = Number.parseInt(this.attributes.lineshapesize ?? "0", 10);
		this.line_style = Number.parseInt(this.attributes.linestyle ?? "0", 10); // 0 = solid, 1 = dashed, 2 = dotted, 3 = dash-dotted
	}
}

class AltiumPolygon extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 7, name: "Polygon", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.points = [];
		let idx = 1;
		while (this.attributes["x" + idx.toString()] != null)
		{
			let x = Number.parseInt(this.attributes["x" + idx.toString()], 10);
			let y = Number.parseInt(this.attributes["y" + idx.toString()], 10);
			this.points.push({ x: x, y: y });
			idx++;
		}
		this.width = Number.parseInt(this.attributes.linewidth ?? "0", 10);
		this.line_color = this.colorToHTML(this.attributes.color);
		this.fill_color = this.colorToHTML(this.attributes.areacolor);
	}
}

class AltiumEllipse extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 8, name: "Ellipse", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.radius_x = Number.parseInt(this.attributes.radius, 10);
		if (this.attributes.secondaryradius != null)
			this.radius_y = Number.parseInt(this.attributes.secondaryradius, 10);
		else
			this.radius_y = this.radius_x;
		this.width = Number.parseInt(this.attributes.linewidth ?? "1", 10);
		this.line_color = this.colorToHTML(this.attributes.color);
		this.fill_color = this.colorToHTML(this.attributes.areacolor);
		this.transparent = (this.attributes.issolid ?? "") != "T";
	}
}

class AltiumPiechart extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 9, name: "Piechart", type: this }) }
	
	constructor(record)
	{
		super(record);
	}
}


class AltiumRoundedRectangle extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 10, name: "Rounded Rectangle", type: this }) }
	
	constructor(record)
	{
		super(record);

		this.rx = Number.parseInt(this.attributes.cornerxradius, 10);
		this.ry = Number.parseInt(this.attributes.corneryradius, 10);

		this.left = Number.parseInt(this.attributes.location_x, 10);
		this.right = Number.parseInt(this.attributes.corner_x, 10);
		this.top = Number.parseInt(this.attributes.corner_y, 10);
		this.bottom = Number.parseInt(this.attributes.location_y, 10);
		this.line_color = this.colorToHTML(this.attributes.color);
		this.fill_color = this.colorToHTML(this.attributes.areacolor);
		this.owner_display_mode = Number.parseInt(this.attributes.ownerpartdisplaymode ?? "-1", 10);
		this.transparent = ((this.attributes.issolid ?? "F") != "T" || (this.attributes.transparent ?? "F") == "T") && this.owner_display_mode < 1;
	}
}


class AltiumEllipticalArc extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 11, name: "Ellipitcal Arc", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.radius = Number.parseInt(this.attributes.radius, 10);
		this.secondary_radius = Number.parseInt(this.attributes.secondaryradius, 10);
		this.start_angle = Number.parseFloat(this.attributes.startangle ?? "0");
		this.end_angle = Number.parseFloat(this.attributes.endangle ?? "360");
		this.width = Number.parseInt(this.attributes.linewidth ?? "1", 10);
		this.color = this.colorToHTML(this.attributes.color);
	}
}


class AltiumArc extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 12, name: "Arc", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.radius = Number.parseInt(this.attributes.radius, 10);
		this.start_angle = Number.parseFloat(this.attributes.startangle ?? "0");
		this.end_angle = Number.parseFloat(this.attributes.endangle ?? "360");
		this.width = Number.parseInt(this.attributes.linewidth ?? "1", 10);
		this.color = this.colorToHTML(this.attributes.color);
	}
}

class AltiumLine extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 13, name: "Line", type: this }) }
	
	constructor(record)
	{
		super(record);
		
		this.x1 = this.parseIntAndFloat(this.attributes, 'location_x');
		this.x2 = this.parseIntAndFloat(this.attributes, 'corner_x');
		this.y1 = this.parseIntAndFloat(this.attributes, 'location_y');
		this.y2 = this.parseIntAndFloat(this.attributes, 'corner_y');
		this.width = Number.parseInt(this.attributes.linewidth ?? "1", 10);
		this.color = this.colorToHTML(this.attributes.color);
	}
}

class AltiumRectangle extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 14, name: "Rectangle", type: this }) }
	
	constructor(record)
	{
		super(record);
		
		this.left = Number.parseInt(this.attributes.location_x, 10);
		this.right = Number.parseInt(this.attributes.corner_x, 10);
		this.top = Number.parseInt(this.attributes.corner_y, 10);
		this.bottom = Number.parseInt(this.attributes.location_y, 10);
		this.line_color = this.colorToHTML(this.attributes.color);
		this.fill_color = this.colorToHTML(this.attributes.areacolor);
		this.owner_display_mode = Number.parseInt(this.attributes.ownerpartdisplaymode ?? "-1", 10);
		this.transparent = ((this.attributes.issolid ?? "F") != "T" || (this.attributes.transparent ?? "F") == "T") && this.owner_display_mode < 1;
	}
}

class AltiumSheetSymbol extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 15, name: "Sheet Symbol", type: this }) }
	
	constructor(record)
	{
		super(record);

		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.width = Number.parseInt(this.attributes.xsize, 10);
		this.height = Number.parseInt(this.attributes.ysize, 10);
		this.fill_color = this.colorToHTML(this.attributes.areacolor);
		this.line_color = this.colorToHTML(this.attributes.color);
	}
}

class AltiumSheetEntry extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 16, name: "Sheet Entry", type: this }) }
	
	constructor(record)
	{
		super(record);

		// Distance from top-left coordinate in x10 units
		this.from_top = 10*Number.parseInt(this.attributes.distancefromtop, 10);
		this.iotype = Number.parseInt(this.attributes.iotype, 10);
		this.font_id = Number.parseInt(this.attributes.textfontid, 10);
		this.side = Number.parseInt(this.attributes.side ?? "0", 10);
		this.style = Number.parseInt(this.attributes.style, 10);
		this.color = this.colorToHTML(this.attributes.color);
		this.text_color = this.colorToHTML(this.attributes.textcolor);
		this.fill_color = this.colorToHTML(this.attributes.areacolor);
		this.name = this.attributes.name;
		this.type = this.attributes.arrowkind;
	}
}

class AltiumPowerPort extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 17, name: "Power Port", type: this }) }
	
	constructor(record)
	{
		super(record);

		const styleNames = ["DEFAULT", "ARROW", "BAR", "WAVE", "POWER_GND", "SIGNAL_GND", "EARTH", "GOST_ARROW", "GOST_POWER_GND", "GOST_EARTH", "GOST_BAR"];

		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.color = this.colorToHTML(this.attributes.color);
		this.show_text = (this.attributes.shownetname ?? "") == "T";
		this.text = (this.attributes._utf8_text ?? this.attributes.text) ?? "";
		this.style = Number.parseInt(this.attributes.style ?? "0", 10);
		this.style_name = (this.style < 0 || this.style > styleNames.length-1) ? "UNKNOWN" : styleNames[this.style];
		this.orientation = Number.parseInt(this.attributes.orientation ?? "0", 10) - 1;
		this.justification = Number.parseInt(this.attributes.justification ?? "1", 10);
		this.is_off_sheet_connector = (this.attributes.iscrosssheetconnector ?? "") == "T";
	}
}

class AltiumPort extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 18, name: "Port", type: this }) }
	
	constructor(record)
	{
		super(record);

		const styles = {"3": 0, "7": 1};
		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.width = Number.parseInt(this.attributes.width, 10);
		this.height = Number.parseInt(this.attributes.height, 10);
		this.border_color = this.colorToHTML(this.attributes.color);
		this.fill_color = this.colorToHTML(this.attributes.areacolor ?? "16777215");
		this.color = this.colorToHTML(this.attributes.textcolor);
		this.text = this.attributes.name ?? "";
		this.iotype = Number.parseInt(this.attributes.iotype ?? "0", 10);
		this.orientation =  styles[this.attributes.style ?? "3"];
	}
}

class AltiumNoERC extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 22, name: "No ERC", type: this }) }
	
	constructor(record)
	{
		super(record);

		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.color = this.colorToHTML(this.attributes.color);
		this.orientation = Number.parseInt(this.attributes.orientation ?? "0", 10);
		this.symbol = this.attributes.symbol;
	}
}

class AltiumNetLabel extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 25, name: "Net Label", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.color = this.colorToHTML(this.attributes.color);
		this.text = (this.attributes._utf8_text ?? this.attributes.text) ?? "";
		this.orientation = Number.parseInt(this.attributes.orientation ?? "0", 10);
		this.justification = Number.parseInt(this.attributes.justification ?? "0", 10);
		this.font_id = Number.parseInt(this.attributes.font_id ?? 1, 10);;
	}
}

class AltiumBus extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 26, name: "Bus", type: this }) }
	
	constructor(record)
	{
		super(record);

		this.points = [];
		let idx = 1;
		while (this.attributes["x" + idx.toString()] != null)
		{
			let x = Number.parseInt(this.attributes["x" + idx.toString()], 10);
			let y = Number.parseInt(this.attributes["y" + idx.toString()], 10);
			this.points.push({ x: x, y: y });
			idx++;
		}
		this.color = this.colorToHTML(this.attributes.color);
		this.width = 3 * Number.parseInt(this.attributes.linewidth, 10);
	}
}

class AltiumWire extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 27, name: "Wire", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.points = [];
		let idx = 1;
		while (this.attributes["x" + idx.toString()] != null)
		{
			let x = Number.parseInt(this.attributes["x" + idx.toString()], 10);
			let y = Number.parseInt(this.attributes["y" + idx.toString()], 10);
			this.points.push({ x: x, y: y });
			idx++;
		}
		this.color = this.colorToHTML(this.attributes.color);
	}
}

class AltiumTextFrame extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 28, name: "Text Frame", type: this }) }
	
	constructor(record)
	{
		super(record);

		this.left = Number.parseInt(this.attributes.location_x, 10);
		this.bottom = Number.parseInt(this.attributes.location_y, 10);
		this.right = Number.parseInt(this.attributes.corner_x, 10);
		this.top = Number.parseInt(this.attributes.corner_y, 10);
		this.border_color = this.colorToHTML(this.attributes.color);
		this.text_color = this.colorToHTML(this.attributes.textcolor);
		this.fill_color = Number.parseInt(this.attributes.areacolor ?? "16777215", 10);
		this.text = (this.attributes._utf8_text ?? this.attributes.text) ?? "";
		this.orientation = Number.parseInt(this.attributes.orientation ?? "0", 10);
		this.alignment = Number.parseInt(this.attributes.alignment ?? "0", 10);
		this.show_border = (this.attributes.showborder ?? "") == "T";
		this.transparent = (this.attributes.issolid ?? "") != "F";
		this.text_margin = Number.parseInt(this.attributes.textmargin ?? "2", 10);
		this.word_wrap = (this.attributes.wordwrap ?? "F") == "T";
		this.font_id = Number.parseInt(this.attributes.fontid ?? "-1", 10);
	}
}

class AltiumJunction extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 29, name: "Junction", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.color = this.colorToHTML(this.attributes.color);
	}
}

class AltiumImage extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 30, name: "Image", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.corner_x = Number.parseInt(this.attributes.corner_x, 10);
		this.corner_y = Number.parseInt(this.attributes.corner_y, 10);
		this.corner_x_frac = Number.parseInt(this.attributes.corner_x_frac, 10);
		this.corner_y_frac = Number.parseInt(this.attributes.corner_y_frac, 10);
		this.keep_aspect = (this.attributes.keepaspect ?? "F") == "T";
		this.embedded = (this.attributes.embedimage ?? "F") == "T";
		this.filename = this.attributes.filename;
	}
}

class AltiumSheet extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 31, name: "Sheet", type: this }) }
	
	static #sheetSizes = [
		[1150, 760],
		[1550, 1110],
		[2230, 1570],
		[3150, 2230],
		[4460, 3150],
		[950, 750],
		[1500, 950],
		[2000, 1500],
		[3200, 2000],
		[4200, 3200],
		[1100, 850],
		[1400, 850],
		[1700, 1100],
		[990, 790],
		[1540, 990],
		[2060, 1560],
		[3260, 2060],
		[4280, 3280]
	];
	
	constructor(record)
	{
		super(record);
		
		this.grid_size = Number.parseInt(this.attributes.visiblegridsize ?? "10", 10);
		this.show_grid = (this.attributes.visiblegridon ?? "") != "F";
		this.areacolor = this.colorToHTML(this.attributes.areacolor);
		
		if (this.attributes.usecustomsheet == 'T')
		{
			this.width = Number.parseInt(this.attributes.customx, 10);
			this.height = Number.parseInt(this.attributes.customy, 10);
		}
		else
		{
			let paperSize = Number.parseInt(this.attributes.sheetstyle ?? "0", 10);
			if (paperSize < AltiumSheet.#sheetSizes.length)
			{
				this.width = AltiumSheet.#sheetSizes[paperSize][0];
				this.height = AltiumSheet.#sheetSizes[paperSize][1];
			}
		}
		
		let f = 1;
		this.fonts = {};
		while (this.attributes["fontname" + f.toString()] != null)
		{
			const fontName = this.attributes["fontname" + f.toString()];
			const fontSize = Number.parseInt(this.attributes["size" + f.toString()] ?? "12", 10);
			const fontBold = (this.attributes["bold" + f.toString()] ?? "") == "T";
			const fontItalics = (this.attributes["italics" + f.toString()] ?? "") == "T";
			this.fonts[f] = { name: fontName, size: fontSize, bold: fontBold, italics: fontItalics};
			f++;
		}
	}
}

class AltiumSheetName extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 32, name: "SheetName", type: this }) }

	constructor(record)
	{
		super(record);
		this.x = Number.parseInt(this.attributes.location_x ?? "0", 10);
		this.y = Number.parseInt(this.attributes.location_y ?? "0", 10);
		this.color = this.colorToHTML(this.attributes.color);
		this.text = (this.attributes._utf8_text ?? this.attributes.text) ?? "";
		this.font_id = Number.parseInt(this.attributes.fontid ?? 1, 10);;
	}
}

class AltiumSheetFilename extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 33, name: "SheetFilename", type: this }) }

	constructor(record)
	{
		super(record);
		this.x = Number.parseInt(this.attributes.location_x ?? "0", 10);
		this.y = Number.parseInt(this.attributes.location_y ?? "0", 10);
		this.color = this.colorToHTML(this.attributes.color);
		this.text = (this.attributes._utf8_text ?? this.attributes.text) ?? "";
		this.font_id = Number.parseInt(this.attributes.fontid ?? 1, 10);;
	}
}

class AltiumDesignator extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 34, name: "Designator", type: this }) }
	
	get full_designator()
	{
		const parent = this.findParent(AltiumComponent);
		
		if (parent == null)
			return this.text;
		
		if (parent.part_count <= 2) // for some reason part count is 2 for single-part components
			return this.text;
		
		if (parent.current_part_id <= 0)
			return this.text;
		
		if (parent.current_part_id <= 26)
			return this.text + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[parent.current_part_id-1];
		else
			return this.text + "[" + parent.current_part_id + "]";
	}
	
	constructor(record)
	{
		super(record);
		this.x = Number.parseInt(this.attributes.location_x ?? "0", 10);
		this.y = Number.parseInt(this.attributes.location_y ?? "0", 10);
		this.color = this.colorToHTML(this.attributes.color);
		this.hidden = (this.attributes.ishidden ?? "") == "T";
		this.text = (this.attributes._utf8_text ?? this.attributes.text) ?? "";
		this.mirrored = (this.attributes.ismirrored ?? "") == "T";
		this.orientation = Number.parseInt(this.attributes.orientation ?? "0", 10);
		this.font_id = Number.parseInt(this.attributes.font_id ?? 1, 10);;
		this.owner_display_mode = Number.parseInt(this.attributes.ownerpartdisplaymode ?? "-1", 10);
	}
}

class AltiumBusEntry extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 37, name: "Line", type: this }) }
	
	constructor(record)
	{
		super(record);
		
		this.x1 = Number.parseInt(this.attributes.location_x, 10);
		this.x2 = Number.parseInt(this.attributes.corner_x, 10);
		this.y1 = Number.parseInt(this.attributes.corner_y, 10);
		this.y2 = Number.parseInt(this.attributes.location_y, 10);
		this.width = Number.parseInt(this.attributes.linewidth ?? "1", 10);
		this.color = this.colorToHTML(this.attributes.color);
	}
}

class AltiumTemplateFile extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 39, name: "TemplateFile", type: this }) }
	
	constructor(record)
	{
		super(record);
	}
}

class AltiumParameter extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 41, name: "Parameter", type: this }) }
	
	get is_implementation_parameter()
	{
		return this.parent_object instanceof AltiumImplementationParameterList;
	}
	
	constructor(record)
	{
		super(record);
		this.x = Number.parseInt(this.attributes.location_x ?? "0", 10);
		this.y = Number.parseInt(this.attributes.location_y ?? "0", 10);
		this.changed = false;
		this.color = this.colorToHTML(this.attributes.color);
		this.name = (this.attributes.name) ?? "";
		this.text = (this.attributes._utf8_text ?? this.attributes.text) ?? "";
		this.hidden = (this.attributes.ishidden ?? "") == "T" || (this.attributes.name ?? "") == "HiddenNetName";
		this.mirrored = (this.attributes.ismirrored ?? "") == "T";
		this.orientation = Number.parseInt(this.attributes.orientation ?? "0", 10);
		this.font_id = Number.parseInt(this.attributes.font_id ?? 1, 10);
		this.owner_display_mode = Number.parseInt(this.attributes.ownerpartdisplaymode ?? "-1", 10);
	}
}

class AltiumWarningSign extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 43, name: "Warning Sign", type: this }) }
	
	constructor(record)
	{
		super(record);
	}
}

class AltiumImplementationList extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 44, name: "Implementation List", type: this }) }
	
	constructor(record)
	{
		super(record);
	}
}

class AltiumImplementation extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 45, name: "Implementation", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.is_current = (this.attributes.iscurrent ?? "") == "T";
		this.description = this.attributes.description;
		this.model_name = this.attributes.modelname;
		this.is_footprint = this.attributes.modeltype == "PCBLIB";
		this.is_sim = this.attributes.modeltype == "SIM";
		this.is_signal_integrity = this.attributes.modeltype == "SI";
	}
}

class AltiumImplementationPinAssociation extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 46, name: "Implementation Pin Association", type: this }) }
	
	constructor(record)
	{
		super(record);
	}
}

class AltiumImplementationPin extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 47, name: "Implementation Pin", type: this }) }
	
	constructor(record)
	{
		super(record);
		this.pin_name = this.attributes.desintf;
	}
}

class AltiumImplementationParameterList extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 48, name: "Implementation Parameter List", type: this }) }
	
	constructor(record)
	{
		super(record);
	}
}

class AltiumHarness extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 215, name: "Harness", type: this }) }
	
	constructor(record)
	{
		super(record);

		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.width = Number.parseInt(this.attributes.xsize, 10);
		this.height = Number.parseInt(this.attributes.ysize, 10);
		this.linewidth = Number.parseInt(this.attributes.linewidth, 10);
		this.side = Number.parseInt(this.attributes.harnessconnectorside ?? "0", 10);
		this.color = this.colorToHTML(this.attributes.color);
		this.areacolor = this.colorToHTML(this.attributes.areacolor);
		this.position = Number.parseInt(this.attributes.primaryconnectionposition, 10);
	}
}

class AltiumHarnessPin extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 216, name: "Harness Pin", type: this }) }
	
	constructor(record)
	{
		super(record);

		this.side = Number.parseInt(this.attributes.side, 10);
		this.from_top = 10 * Number.parseInt(this.attributes.distancefromtop ?? "0", 10);
		let from_top_frac = Number.parseInt(this.attributes.distancefromtop_frac1 ?? "0", 10);
		this.from_top += (from_top_frac / 100_000);
		this.color = this.colorToHTML(this.attributes.color);
		this.areacolor = this.colorToHTML(this.attributes.areacolor);
		this.textcolor = this.colorToHTML(this.attributes.textcolor);
		this.font_id = Number.parseInt(this.attributes.textfontid ?? "-1", 10);
		this.text_style = this.attributes.textstyle;
		this.name = this.attributes.name;
	}
}

class AltiumHarnessLabel extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 217, name: "Harness Label", type: this }) }
	
	constructor(record)
	{
		super(record);

		this.x = Number.parseInt(this.attributes.location_x, 10);
		this.y = Number.parseInt(this.attributes.location_y, 10);
		this.text = this.attributes.text;
		this.color = this.colorToHTML(this.attributes.color);
		this.font_id = Number.parseInt(this.attributes.fontid ?? "-1", 10);
	}
}

class AltiumHarnessWire extends AltiumObject
{
	static { AltiumObject.RecordObjectMap.push({ id: 218, name: "Harness Wire", type: this }) }
	
	constructor(record)
	{
		super(record);

		this.points = [];
		let idx = 1;
		while (this.attributes["x" + idx.toString()] != null)
		{
			let x = Number.parseInt(this.attributes["x" + idx.toString()], 10);
			let y = Number.parseInt(this.attributes["y" + idx.toString()], 10);
			this.points.push({ x: x, y: y });
			idx++;
		}
		this.color = this.colorToHTML(this.attributes.color);
		this.width = Number.parseInt(this.attributes.linewidth, 10);
	}
}

class AltiumDocument
{

	static #stringDecoder = new TextDecoder('utf-8');
	static get StringDecoder() { return AltiumDocument.#stringDecoder; }

	constructor(data_source)
	{
		this.records = [];
		this.objects = [];
		this.source = data_source;
		this.record_object_lookup = {};
        if (typeof(this.source[0]) == "number")
			this.from_stream();
		else
			this.from_records_list();

		let record_object_lookup = {};
		for (let record of this.records)
		{			
			let mapping = AltiumObject.RecordObjectMap.find((rom) => rom.id == record.record_id);
			let recordObject = null;
			if (mapping != null)
			{
				const objectType = mapping.type;
				recordObject = new objectType(record);
			}
			else
			{
				// generic object (specific parsing unimplemented)
				recordObject = new AltiumObject(record);
				recordObject.is_unknown_type = true;
			}
			this.objects.push(recordObject);
			record_object_lookup[record.record_index] = recordObject;
		}
		let last_harness = null;
		for (let object of this.objects)
		{
			if (object instanceof AltiumHarness)
				last_harness = object;
			if (object instanceof AltiumHarnessWire || object instanceof AltiumHarnessPin)
				object.parent = last_harness
			if (object.owner_record_index < 0)
				continue;
			let ownerObject = record_object_lookup[object.owner_record_index];
			if (ownerObject == null)
				continue;
			object.parent_object = ownerObject;
			ownerObject.child_objects.push(object);
		}
		this.record_object_lookup = record_object_lookup;
		this.sheet = this.objects.find(o => o instanceof AltiumSheet);
	}

	from_records_list()
	{
		let index = 0;
		for (const block of this.source)
		{
			if (!block.startsWith("|RECORD="))
				continue;
			let id = block.slice("|RECORD=".length).split("|")[0];
			let record_id = parseInt(id);
			this.records.push(new AltiumRecord(record_id, block, index));
			index++;
		}
	}

	from_stream()
	{
		const min_record_size = 4
		let index = -1; // header comes first, so give it an index of -1
		while (this.source.u8stream_position + min_record_size < this.source.length)
		{
			let payload_length = this.source.read_u16_le();
			let padding = this.source.read_u8();
			if (padding != 0)
				console.warn("Padding byte on record index " + index.toString() + " was non-zero.");
			let record_type = this.source.read_u8();
			if (record_type != 0)
				throw new Error("Invalid record type.");
			let data = this.source.read(payload_length);
			// check if this starts with |RECORD=
			if (data.compare_to(new Uint8Array([0x7c, 0x52, 0x45, 0x43, 0x4f, 0x52, 0x44, 0x3d])))
			{
				let recordFieldStr = AltiumDocument.StringDecoder.decode(data.slice(8, 12));
				let recordIdStr = recordFieldStr.split('|')[0];
				let record_id = Number.parseInt(recordIdStr, 10);
				let block = AltiumDocument.StringDecoder.decode(data).slice(0, -1);
				this.records.push(new AltiumRecord(record_id, block, index));
				index++;
			}
		}
	}
	
	object_from_record_index(index)
	{
		for (let obj of this.objects)
		{
			if (obj.record_index == index)
				return obj;
		}
		return null;
	}
	
	setVariant(variant) {
		for (let designator in variant.result) {
			let results = this.objects.filter(x => {
				return x instanceof AltiumDesignator && x.text == designator
			});
			if (results.length === 0)
				continue
			let component = results[0].parent_object;
			let changes = Object.keys(variant.result[designator]);
			if (changes.length == 0) {
				component.dnp = true;
				continue
			}
			component.child_objects.forEach(x => {
				if (x instanceof AltiumParameter) {
					let new_value = variant.result[designator][x.name];
					if (new_value !== undefined) {
						x.text = new_value;
						x.changed = true;
					}
				}
			});
		}
	}

	
	findParentRecord(start_index, record_type)
	{
		let currentRecord = this.records.find((r) => r.record_index == start_index);
		if (currentRecord == null)
			return null;
		while (true)
		{
			if (currentRecord.record_id == record_type)
				return currentRecord;
			
			let ownerIndexAttr = currentRecord.attributes.find((a) => a.name.toLowerCase() == "ownerindex");
			
			if (ownerIndexAttr == null || ownerIndexAttr?.value == null || ownerIndexAttr?.value == "")
				return null;
			let ownerIndex = Number.parseInt(ownerIndexAttr.value, 10);
			if (ownerIndex < 0)
				return null;
			
			let nextRecord = this.records.find((r) => r.record_index == ownerIndex);
			if (nextRecord == null)
				return null;
			
			currentRecord = nextRecord;
		}
	}
	
	find_child_records(parent_index, record_type=null)
	{
		results = [];
		for (let currentRecord in this.records)
		{
			if (record_type != null && currentRecord.record_id != record_type)
				continue;
			
			let ownerIndexAttr = currentRecord.attributes.find((a) => a.name.toLowerCase() == "ownerindex");
			if (ownerIndexAttr == null || ownerIndexAttr?.value == null || ownerIndexAttr?.value == "")
				continue;
			
			let ownerIndex = Number.parseInt(ownerIndexAttr.value, 10);
			if (ownerIndex == parent_index)
				results.push(currentRecord);
		}
		return results;
	}
}
