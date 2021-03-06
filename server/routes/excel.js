import express from 'express';
import multer from 'multer';
import {Excel, Showtime, Reservation, SeatsSerial} from '../models';
import XLSX from 'xlsx';
import moment from 'moment-timezone';
import tmp from 'tmp';
import {datetime} from './module';

const router = express.Router();

// 파일 업로드 모듈. 최대 사이즈 : 30MB
const upload = multer({
    storage : multer.memoryStorage(),
    limits : {fileSize : 1024 * 1024 * 30}
});

router.post('/parse/showtime', upload.single('file'), (req, res) => {
//차후 show의 schedule 업데이트할 주소
    //<1. 엑셀 파일 로드>
    //엑셀 파일 버퍼 읽기
    const Excel_file_buffer = req.file.buffer;
    const Excel_file = XLSX.read(Excel_file_buffer);

    //엑셀 시트 읽기
    const Excel_sheet = Excel_file.Sheets[Excel_file.SheetNames[0]];
    const Excel_sheet_range = XLSX.utils.decode_range(Excel_sheet['!ref'].toString());

    const columns_parser = {
        date : 0,
        time : 1,
        url : 2
    };
    let parsed = [];

    for(let r = Excel_sheet_range.s.r;r<=Excel_sheet_range.e.r;r++) {
        let row = {};
        for(let col in columns_parser) {
            let cell_address = XLSX.utils.encode_cell({c: columns_parser[col], r: r});
            row[col] = Excel_sheet[cell_address].v;
        }
        parsed.push(row);
    }

    let results = [];
    for(let o of parsed) {
        let obj = {
            date :'',
            url : o.url
        };
        let year = new RegExp('[0-9]+(?=년)').exec(o.date)[0];
        let mon = new RegExp('[0-9]+(?=월)').exec(o.date)[0];
        let day = new RegExp('[0-9]+(?=일)').exec(o.date)[0];
        let hour = new RegExp('[0-9]+(?=시)').exec(o.time)[0];
        let min = new RegExp('[0-9]+(?=분)').exec(o.time)[0];
        obj.date = new Date(moment.tz([year,mon-1,day,hour,min], 'Asia/Seoul').format());

        results.push(obj);
    }
    res.json({data:results});
});
router.post('/parse/theater', upload.single('file'), (req, res) => {
    /*
     column은 반드시 다음의 순서를 맞춰야 한다.
     층 수, 열, 번호, 등급
     */
    //엑셀 파일 버퍼 읽기
    const Excel_file_buffer = req.file.buffer;
    const Excel_file = XLSX.read(Excel_file_buffer);

    //엑셀 시트 읽기
    const Excel_sheet = Excel_file.Sheets[Excel_file.SheetNames[0]];
    const Excel_sheet_range = XLSX.utils.decode_range(Excel_sheet['!ref'].toString());

    const columns_parser = {
        floor : 0,
        col : 1,
        num : 2,
        seat_class:3
    };
    let seats = [];
    for(let r = Excel_sheet_range.s.r;r<=Excel_sheet_range.e.r;r++) {
        let seat = {};
        for(let col in columns_parser) {

                let cell_address = XLSX.utils.encode_cell({c: columns_parser[col], r: r});
                seat[col] = Excel_sheet[cell_address].v;

        }
        seats.push(seat);
    }
    res.json({data:seats});
});
// 엑셀 파일 업로드
/*
 <프로세스>
 1. 엑셀 파일 로드
 2. 파싱 데이터 로드
 3. 파싱
 4. 파싱되지 않은 값에 기본값 대입
 5. 파싱된 데이터를 통해 예매 데이터로 변환
 6. 예매 데이터 출력
 */
router.post('/parse/reservation', upload.single('file'), (req, res) => {

    //<1. 엑셀 파일 로드>
    //엑셀 파일 버퍼 읽기
    const Excel_file_buffer = req.file.buffer;
    const Excel_file = XLSX.read(Excel_file_buffer);

    //엑셀 시트 읽기
    const Excel_sheet = Excel_file.Sheets[Excel_file.SheetNames[0]];
    const Excel_sheet_range = XLSX.utils.decode_range(Excel_sheet['!ref'].toString());

    //<2. 파싱 데이터 로드>
    //source(ex.쿠팡)를 이용하여 엑셀 파싱 데이터 로드
    /* 파싱할 값. 필수->반드시 파싱되어야 할 값
     customer_name,         //필수 - 고객 이름
     customer_phone,        //필수 - 고객 번호 (뒤 4자리)
     show_date_year,        //없을 시 month가 현재 월보다 작으면 올해+1 아니면 올해 - 공연 연도
     show_date_month,       //필수 - 공연 월
     show_date_day,         //필수 - 공연 일
     show_time_hour,        //필수 - 공연 시간
     show_time_minute,      //없을 시 0 - 공연 분
     seat_class,            //필수 - 좌석 등급
     seat_position_floor,   //없을 시 undefined - 좌석 층수
     seat_position_col,     //없을 시 undefined - 좌석 열
     seat_position_num,     //없을 시 undefined - 좌석 번호
     ticket_quantity,       //없을 시 1 - 티켓 수량
     ticket_code,           //필수 - 예약 번호, 주문 번호, 티켓 번호 등 각 사이트별 코드
     ticket_price,          //필수 - 티켓 가격
     discount               //없을시 undefined
     */
    //타 조회처럼 Excel.find().lean().exec()으로 조회시 검색 시간이 빨라지나,
    //파싱 데이터에 저장된 함수를 Mongoose가 함수로 파싱하지 못한다.
    Excel.find({_id:req.body._id}).exec((err, results) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message:'Excel Upload Error - '+err.message});
        }

        let excel = results[0]; //단순 object가 아니라 mongoose object 파일이다.(함수 정보 존


        //<3. 파싱>
        //필드가 들어있는 row의 위치를 찾아 저장한다.
        //모든 필드는 같은 row에 있어야 한다.
        //엑셀 파싱 데이터의 customer_name에 있는 필드명은 반드시 있어야 한다.
        const key = excel.parsing_rule.customer_name.field;
        let field_row = -1;
        for(let r = Excel_sheet_range.s.r;r<=Excel_sheet_range.e.r;r++) {
            for(let c = Excel_sheet_range.s.c;c<=Excel_sheet_range.e.c;c++) {
                let cell_address = XLSX.utils.encode_cell({c: c,r: r});
                if(Excel_sheet[cell_address] && Excel_sheet[cell_address].v === key){
                    field_row = r;
                }
            }
        }
        //필드가 있는 row를 못찾으면 에러 리턴
        if(field_row === -1){
            return res.status(400).json({message:'Excel Upload Error - '+'cannot find customer_name in excel file'});
        }

        //필드 row에서 필드명에 따른 column의 위치를 저장
        for(let c = Excel_sheet_range.s.c;c<=Excel_sheet_range.e.c;c++) {

            let cell_address = XLSX.utils.encode_cell({c: c, r: field_row});

            for(let i in excel.parsing_rule) {
                if(excel.parsing_rule.hasOwnProperty(i))
                {

                    if (excel.parsing_rule[i] && excel.parsing_rule[i].field === Excel_sheet[cell_address].v) {

                        excel.parsing_rule[i].c = c;
                    }else {

                    }
                }
            }
        }

        //파싱 데이터에 필드명이 있는데 칼럼을 못찾았을 경우 에러 리턴
        for(let i in excel.parsing_rule) {
            if(excel.parsing_rule.hasOwnProperty(i))
            {
                if(excel.parsing_rule[i] && excel.parsing_rule[i].field) {

                    if(excel.parsing_rule[i].c!==0 && !excel.parsing_rule[i].c || excel.parsing_rule[i].c ==='') {
                        return res.status(400).json({message: 'Excel Upload Error - '+'cannot parse ' + i});
                    }
                }
            }
        }

        //파싱한 내용을 저장할 객체 초기화
        let parsed_rows = {};
        for(let row = field_row+1;row<=Excel_sheet_range.e.r;row++) {
            parsed_rows[row] = {};
        }

        try {
            //파싱 진행
            for (let i in excel.parsing_rule) {

                if (excel.parsing_rule.hasOwnProperty(i) && excel.parsing_rule[i] && excel.parsing_rule[i].field && (excel.parsing_rule[i].c||excel.parsing_rule[i].c===0)) {
                    for (let row = field_row + 1; row <= Excel_sheet_range.e.r; row++) {
                        //셀의 내용 접근
                        let cell_address = XLSX.utils.encode_cell({c: excel.parsing_rule[i].c, r: row});

                        //v는 셀의 내용의 raw 데이터
                        let cell_data = Excel_sheet[cell_address].v;
                        //정규식을 이용한 파싱 직전에 셀의 내용에서 공백과 빈칸을 전부 없앤다.
                        if (typeof cell_data === 'string')
                            cell_data = cell_data.replace(/\s/gi, "");
                        //정규식을 이용한 파싱 (정규식 코드 없으면 셀 내용 변경 안함)
                        if (excel.parsing_rule[i] && excel.parsing_rule[i].code) {
                            // console.log(i +' - '+Excel_sheet[cell_address]);
                            cell_data = excel.parsing_rule[i].code(cell_data);
                        }
                        parsed_rows[row][i] = cell_data;
                    }
                }
            }
        }catch(e) {
            console.log(e);
            return res.status(400).json({message: 'Excel Upload Error - '+'파싱 코드에 문제가 있습니다.'});
        }

        //<4. 파싱되지 않은 값에 기본값 대입>
        //필수적인 파싱 데이터 존재 확인. 필수적이지 않은 데이터는 파싱되지 않았을 시 기본값으로 초기화
        let parsed_rows_array = [];
        for(let i in parsed_rows) {
            let o = parsed_rows[i];
            //필수 데이터 확인
            if(!( o['customer_name'] &&
                o['customer_phone'] &&
                o['show_date_month'] &&
                o['show_date_day'] &&
                o['show_time_hour'] &&
                o['seat_class'] &&
                o['ticket_code'] &&
                o['ticket_price'])) {
                return res.status(400).json({message: 'Excel Upload Error - ' + '필수적인 파싱 내용 빠짐'});
            }
            //공연 연도 미입력 시 현재 연도 입력.
            //단, 현재 월보다 공연 월이 적은 값일 경우 내년이라고 인식하고 현재 연도+1을 입력
            if(!o['show_date_year']) {
                let month = o['show_date_month'];

                let current_month = new Date(moment().tz("Asia/Seoul").format()).getMonth()+1;
                let year = new Date(moment().tz("Asia/Seoul").format()).getFullYear();
                if(month<current_month)
                    year++;
                o['show_date_year'] = year;
            }
            //분 초기화 -> 0
            if(!(o['show_time_minute'])) {
                o['show_time_minute'] = 0;
            }
            //층수 초기화
            if(!(o['seat_position_floor'])) {
                o['seat_position_floor'] = undefined;
            }
            // 열 초기화
            if(!(o['seat_position_col'])) {
                o['seat_position_col'] = undefined;
            }
            // 번호 초기화
            if(!(o['seat_position_num'])) {
                o['seat_position_num'] = undefined;
            }
            // 티켓 수량 초기화
            if(!(o['ticket_quantity'])) {
                o['ticket_quantity'] = 1;
            }
            // 할인 초기화
            if(!(o['discount'])) {
                o['discount'] = undefined;
            }
            parsed_rows_array.push(o);
        }


        //<5. 파싱된 데이터를 통해 예매 데이터로 변환>
        /*파싱된 데이터를 통해 표준 예매 데이터로 변환
         source,              //공연 예매 출처
         customer_name,       //고객 성함
         customer_phone,      //고객 번호(뒷 4자리)
         show_date : '',      //공연 날짜 및 시간 (DATE 객체)
         seat_class : '',     //좌석 등급
         seat_position : {    //좌석 위치 -> 없을 시 undefined
         floor,
         col,
         num
         },
         ticket_quantity,     //티켓 수량
         ticket_code,         //예약 번호, 주문 번호, 티켓 번호 등 각 사이트별 코드
         ticket_price,        //티켓 가격
         theater,             //공연장 참조
         show,                //공연 참조
         discount             //할인 내역
         */
        let outputs = [];
        for(let i=0;i<parsed_rows_array.length;i++) {
            let row = parsed_rows_array[i];
            let output = {};
            output.source = excel.source;
            output.customer_name = row.customer_name;
            output.customer_phone = row.customer_phone;

            output.show_date = new Date(
                moment.tz([
                    row.show_date_year,
                    row.show_date_month-1,
                    row.show_date_day,
                    row.show_time_hour,
                    row.show_time_minute], 'Asia/Seoul').format());

            output.seat_class = row.seat_class;
            if(!row.seat_position_floor && !row.seat_position_col && !row.seat_position_num)
                output.seat_position = undefined;
            else
                output.seat_position = {
                    floor : row.seat_position_floor,
                    col : row.seat_position_col,
                    num : row.seat_position_num
                };
            output.ticket_quantity = row.ticket_quantity;
            output.ticket_code = row.ticket_code;
            output.ticket_price = row.ticket_price;
            output.theater = req.body.theater;
            output.show = req.body.show;
            output.discount = row.discount;
            outputs.push(output);
        }

        //<6. 예매 데이터 출력>
        return res.json({
            data: outputs
        });
    });
});
router.post('/parse/naverReservation', upload.single('file'), (req, res) => {

    //엑셀 파일 버퍼 읽기
    const Excel_file_buffer = req.file.buffer;
    const Excel_file = XLSX.read(Excel_file_buffer);

    //엑셀 시트 읽기
    const Excel_sheet = Excel_file.Sheets[Excel_file.SheetNames[0]];
    const Excel_sheet_range = XLSX.utils.decode_range(Excel_sheet['!ref'].toString());

    const wb = XLSX.utils.book_new();
    const ws_name = "naver";
//
    const ws_data = [
        [],
    ];


    let field_row = -1;
    for(let r = Excel_sheet_range.s.r;r<=Excel_sheet_range.e.r;r++) {
        for(let c = Excel_sheet_range.s.c;c<=Excel_sheet_range.e.c;c++) {
            let cell_address = XLSX.utils.encode_cell({c: c,r: r});
            if(Excel_sheet[cell_address] && Excel_sheet[cell_address].v === '예약번호'){
                field_row = r;
            }
        }
    }
//         //필드가 있는 row를 못찾으면 에러 리턴
    if(field_row === -1){
        // return res.status(400).json({message:'Excel Upload Error - '+'cannot find customer_name in excel file'});
    }

//필드 row에서 필드명에 따른 column의 위치를 저장
    const columns = [];
    for(let c = Excel_sheet_range.s.c;c<=Excel_sheet_range.e.c;c++) {
        let cell_address = XLSX.utils.encode_cell({c: c, r: field_row});

        let cell_data = Excel_sheet[cell_address].v;
        columns.push(cell_data);
        ws_data[0].push(cell_data) ;
    }
    ws_data[0].push('좌석등급') ;
    ws_data[0].push('티켓가격') ;


    const prohibitedIndex = {
        ticket_quantity :columns.findIndex((s)=>{return s==='수량'}),
        ticket_quantity_VIP :columns.findIndex((s)=>{return s==='가격분류1-VIP석_네이버예약60%할인'}),
        ticket_quantity_R :columns.findIndex((s)=>{return s==='가격분류2-R석_네이버예약시60%할인'}),
        ticket_price :columns.findIndex((s)=>{return s==='실결제금액'})
    };

    for (let row = field_row + 1; row <= Excel_sheet_range.e.r; row++) {
        const ticket_quantity = parseInt(Excel_sheet[XLSX.utils.encode_cell({c: prohibitedIndex.ticket_quantity, r: row})].v);
        const ticket_quantity_VIP = parseInt(Excel_sheet[XLSX.utils.encode_cell({c: prohibitedIndex.ticket_quantity_VIP, r: row})].v);
        const ticket_quantity_R = parseInt(Excel_sheet[XLSX.utils.encode_cell({c: prohibitedIndex.ticket_quantity_R, r: row})].v);

        let ticket_price_temp = Excel_sheet[XLSX.utils.encode_cell({c: prohibitedIndex.ticket_price, r: row})].v;
        let split = ticket_price_temp.split(',');
        let r = '';
        for(let i=0;i<split.length;i++){
            r = r.concat(split[i])
        }
        const ticket_price = parseInt(r);

        const ticket_code_index = columns.findIndex((s) => {return s==='예약번호';});

        for(let i=0;i<ticket_quantity_VIP;i++) {
            const row_data = [];
            for (let c = Excel_sheet_range.s.c; c <= Excel_sheet_range.e.c; c++) {
                if( c === prohibitedIndex.ticket_quantity     ||
                    c === prohibitedIndex.ticket_quantity_VIP ||
                    c === prohibitedIndex.ticket_quantity_R   ||
                    c === prohibitedIndex.ticket_price){

                    row_data.push('');
                    continue;
                }



                let cell_address = XLSX.utils.encode_cell({c: c, r: row});

                let cell_data = Excel_sheet[cell_address].v;

                if(c===ticket_code_index)
                    cell_data += '-'+(i+1);

                row_data.push(String(cell_data))
            }
            row_data.push('VIP');
            row_data.push(parseInt(ticket_price)/parseInt(ticket_quantity));
            ws_data.push(row_data);
        }
        for(let i=0;i<ticket_quantity_R;i++) {
            const row_data = [];
            for (let c = Excel_sheet_range.s.c; c <= Excel_sheet_range.e.c; c++) {
                if( c === prohibitedIndex.ticket_quantity     ||
                    c === prohibitedIndex.ticket_quantity_VIP ||
                    c === prohibitedIndex.ticket_quantity_R   ||
                    c === prohibitedIndex.ticket_price){

                    row_data.push('');
                    continue;

                }

                let cell_address = XLSX.utils.encode_cell({c: c, r: row});

                let cell_data = Excel_sheet[cell_address].v;

                if(c===ticket_code_index)
                    cell_data += '-'+(i+1+ticket_quantity_VIP);

                row_data.push(String(cell_data))
            }
            row_data.push('R');
            row_data.push(Math.round(parseInt(ticket_price)/parseInt(ticket_quantity)));
            ws_data.push(row_data);
        }
    }

    const ws = XLSX.utils.aoa_to_sheet(ws_data);

    wb.SheetNames.push(ws_name);

    wb.Sheets[ws_name] = ws;


    tmp.file(function _tempFileCreated(err, path, fd, cleanupCallback) {
        if (err) throw err;
        XLSX.writeFile(wb, path);
        return res.download(path, 'naver.xlsx');
    });

});

router.post('/ticketExcel', (req, res) => {
    const wb = XLSX.utils.book_new();
    const ws_name = "tickets";

    const ws_data = [
        [ "단체명", "공연일시", "발권인원", "좌석등급", "판매가", "좌석번호"],
    ];

    for(let r of req.body.data) {
        const date = new datetime(r.show_date);

        ws_data.push([
            r.source,
            date.datetimeString,
            r.ticket_quantity,
            r.seat_class,
            r.ticket_price,
            r.seat_position.col+'열 '+r.seat_position.num+'번'
        ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(ws_data);

    wb.SheetNames.push(ws_name);

    wb.Sheets[ws_name] = ws;

    tmp.file(function _tempFileCreated(err, path, fd, cleanupCallback) {
        if (err) throw err;
        XLSX.writeFile(wb, path);
        return res.download(path, 'tickets.xlsx');
    });

});
router.get('/showtime/:showtime/date/:date', (req, res) => {
    const input = {
        showtime: req.params.showtime,
        date: new Date(parseInt(req.params.date))
    };

    Showtime.find({_id:input.showtime})
        .populate('theater')
        .exec((err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({message: 'Data Read Error - ' + err.message});
            }
            if (!results || results.length < 1) {
                return res.status(500).json({message: 'Data Read Error - ' + '공연일정(Showtime)을 _id로 찾을 수 없습니다.'});
            }
            if (!results[0].theater) {
                return res.status(500).json({message: 'Data Read Error - ' + '공연장(Theater)을 _id로 찾을 수 없습니다.'});
            }

            const schedules = results[0].schedule;
            const theater_seats = results[0].theater.seats;
            const Arr = [];

            let i=0;
            for (let seat of theater_seats) {
                Arr.push({
                    num                      :++i,
                    show_date                :input.date,
                    ticket_quantity          :1, // 좌석 당 예약은 하나
                    seat_class               :seat.seat_class,
                    ticket_price             :seat.seat_class==='VIP' ? 50000 : (seat.seat_class==='R' ? 40000 : undefined),
                    seat_position            :{col : seat.col, num :seat.num},
                    source                   :undefined,
                    group_name               :undefined,
                    customer_name            :undefined,
                    customer_phone           :undefined,
                    discount                 :undefined
                });
            }

            let schedule;
            for (let s of schedules)
                if (new Date(s.date).getTime() === parseInt(req.params.date))
                    schedule = s;

            const wrapper = {
                data : input
            };
            fetch( `${req.protocol}://${req.get('Host')}`+'/api/showtime/crawl',{
                method : 'POST',
                headers : {'Content-Type' : 'application/json'},
                body : JSON.stringify(wrapper)
            })
                .then(response =>{
                    if(response.ok)
                        return response.json();
                    else
                        return response.json().then(err => { throw err; })})
                .then(response => {

                    /*

                    본 주석 코드를 사용하면
                    크롤링 된 내역들이 '인터파크' , '미확인' 으로 기본적으로 들어간다.

                     */
                    // const crawled_seats = response.data;
                    //
                    // const reserved_seats = theater_seats.filter((ts) => {
                    //     return crawled_seats.filter((cs) => {
                    //             return ts.col===cs.col && ts.floor === cs.floor && ts.num === cs.num
                    //         }).length===0;
                    // });
                    // for(let c of reserved_seats) {
                    //     let obj = Arr.find((item) => {
                    //         if (
                    //             item.seat_position.col === c.col &&
                    //             item.seat_position.num === c.num
                    //         )
                    //             return true;
                    //     });
                    //     if(obj) {
                    //         obj.source = '인터파크';
                    //         obj.customer_name = '미확인';
                    //         obj.customer_phone = '미확인';
                    //     }
                    //
                    // }


                    Reservation.populate(schedule.reservations, {path: '_id'}, (err, results) => {
                        results.forEach((r) => {
                                let reservation = r._id; // _id로 객체가 감싸여 있다,
                            //mongoose documnet to javascript object
                            if( reservation &&
                                reservation.seat_position &&
                                reservation.seat_position.col &&
                                reservation.seat_position.num) {

                                let obj = Arr.find((item) => {
                                    if(
                                        item.seat_position.col === reservation.seat_position.col &&
                                        item.seat_position.num === reservation.seat_position.num
                                    )
                                        return true;
                                });

                                if(obj) {
                                    obj.customer_name =  reservation.customer_name;
                                    obj.customer_phone = reservation.customer_phone;
                                    obj.group_name = reservation.group_name;
                                    obj.source = reservation.source;
                                    obj.ticket_price = reservation.ticket_price;
                                    obj.discount = reservation.discount
                                }
                                else {
                                    // console.log(reservation.seat_position);
                                }
                            }
                        });

                        const wb = XLSX.utils.book_new();
                        const ws_name = "reservations";
                        let ws_data = [
                            [ "일련번호", "공연일시", "발권인원", "좌석등급", "판매가", "좌석번호", "구매처", "단체명", "구매자성명", "전화번호", "할인내역"],
                        ];

                        let ws_body = [];
                        let ws_body2 = [];

                        for(let r of Arr) {
                            for (let prop in r)
                                r[prop] = r[prop] ? r[prop] : '';

                            const date = new datetime(r.show_date);

                            ws_body.push([
                                0,
                                date.datetimeString,
                                String(r.ticket_quantity),
                                String(r.seat_class),
                                String(r.ticket_price),
                                r.seat_position.col + '열 ' + r.seat_position.num + '번',
                                r.source,
                                r.group_name,
                                r.customer_name,
                                String(r.customer_phone),
                                r.discount
                            ]);
                            ws_body2.push({
                                serialNum : null,
                                col : r.seat_position.col,
                                num : r.seat_position.num
                            });
                        }

                        const infoForSeatsSerial = [];
                        const temp_infoForSeatsSerial = [];

                        const result = [];
                        const temp = [];

                        let n =0;
                        for(let i=0;i<ws_body.length;i++) {
                            if(ws_body[i][6] === '인터파크') {
                                ws_body[i][0] = ++n;
                                result.push(ws_body[i]);

                                ws_body2[i].serialNum = n;
                                infoForSeatsSerial.push(ws_body2[i]);
                            }
                            else {
                                temp.push(ws_body[i]);
                                temp_infoForSeatsSerial.push(ws_body2[i]);
                            }
                        }

                        for(let i=0;i<temp.length;i++) {
                            temp[i][0] = ++n;
                            temp_infoForSeatsSerial[i].serialNum = n;
                        }

                        let result_seat = result.concat(temp);

                        let result_infoForSeatsSerial = infoForSeatsSerial.concat(temp_infoForSeatsSerial);
                        let date = Arr[0].show_date;
                        SeatsSerial.update({
                            date : date
                        },
                            {$set:{seats : result_infoForSeatsSerial}},
                            {upsert:true}
                        ).exec((err, results) => {

                            const ws = XLSX.utils.aoa_to_sheet(ws_data.concat(result_seat));

                            wb.SheetNames.push(ws_name);

                            wb.Sheets[ws_name] = ws;

                            tmp.file(function _tempFileCreated(err, path, fd, cleanupCallback) {
                                if (err) throw err;
                                XLSX.writeFile(wb, path);
                                return res.download(path, 'reservations.xlsx');
                            });

                        });


                });
            });
        });
});
//엑셀 파싱 룰을 생성한다.
router.post('/create', (req, res) => {
    const excel = new Excel(req.body.data);
    excel.save((err, results) => {
        if(err) {
            console.error(err);
            return res.status(500).json({message:'Excel Create Error - '+err.message});
        }
        else {
            return res.json({
                data : results
            });
        }
    });
});
//엑셀 파싱 룰을 조회한다.
router.get('/read/:key_name/:key_value', (req, res) => {

    const key_name = req.params.key_name;
    const key_value = req.params.key_value;

    const keys = ['source', '_id'];
    if(keys.indexOf(key_name) < 0)
        return res.status(500).json({message:'Excel Read Error - '+'잘못된 key 이름을 입력하셨습니다 : '+key_name});

    let query = {};
    query[key_name] = key_value;

    //lean() -> 조회 속도 빠르게 하기 위함
    Excel.find(query).lean().exec((err, results) => {
        if(err) {
            console.error(err);
            return res.status(500).json({message:'Excel Read Error - '+err.message});
        }
        else {
            return res.json({
                data:results
            });
        }
    });
});
//엑셀 파싱 룰을 전체 조회한다.
router.get('/read', (req, res) => {
    //lean() -> 조회 속도 빠르게 하기 위함
    Excel.find({}).lean().exec((err, results) => {
        if(err) {
            console.error(err);
            return res.status(500).json({message:'Excel Read Error - '+err.message});
        }
        else {
            return res.json({
                data : results
            });
        }
    });
});
//엑셀 파싱 룰을 수정한다.
router.put('/update', (req, res) => {
    Excel.update({_id:req.body.data._id}, {$set: req.body.data.update}, (err, results) => {
        if(err) {
            console.error(err);
            return res.status(500).json({message:'Excel Modify Error - '+err.message});
        }
        else {
            return res.json({
                data : results
            });
        }
    });
});
//엑셀 파싱 룰을 삭제한다.
router.delete('/delete', (req, res) => {
    Excel.remove({_id:req.body.data._id}, (err, results) => {
        if(err) {
            console.error(err);
            return res.status(500).json({message:'Excel Delete Error - '+err.message});
        }
        else {
            console.log(results);
            return res.json({
                data : results.result
            });
        }
    });
});

export default router;